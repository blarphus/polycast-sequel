import Foundation
import Compression

// MiniZip — a tiny, dependency-free reader for the subset of ZIP needed to open EPUB files.
// EPUB archives only ever use STORE (method 0) or DEFLATE (method 8). Apple's Compression
// framework decodes raw DEFLATE streams directly with COMPRESSION_ZLIB, so no third-party
// unzip dependency is required.
enum MiniZipError: LocalizedError {
    case notAZip
    case corrupt(String)
    case inflateFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAZip: return "This file is not a valid ZIP/EPUB archive."
        case .corrupt(let detail): return "The archive is corrupt: \(detail)"
        case .inflateFailed(let name): return "Could not decompress \(name)."
        }
    }
}

struct MiniZip {
    private let data: [UInt8]
    private var entries: [String: Entry] = [:]

    private struct Entry {
        let method: UInt16
        let compressedSize: Int
        let uncompressedSize: Int
        let localHeaderOffset: Int
    }

    init(data rawData: Data) throws {
        self.data = [UInt8](rawData)
        try parseCentralDirectory()
    }

    /// Names of every file stored in the archive.
    var fileNames: [String] { Array(entries.keys) }

    /// Returns the decompressed bytes for a stored path, or nil if absent.
    func data(for path: String) throws -> Data? {
        guard let entry = entries[path] else { return nil }

        // The local file header may carry different extra-field length than the central
        // record, so recompute the data start from the local header itself.
        let lh = entry.localHeaderOffset
        guard lh + 30 <= data.count, readU32(lh) == 0x04034b50 else {
            throw MiniZipError.corrupt("bad local header for \(path)")
        }
        let nameLen = Int(readU16(lh + 26))
        let extraLen = Int(readU16(lh + 28))
        let start = lh + 30 + nameLen + extraLen
        let end = start + entry.compressedSize
        guard end <= data.count else { throw MiniZipError.corrupt("truncated entry \(path)") }

        let slice = Array(data[start..<end])
        if entry.method == 0 {
            return Data(slice)
        }
        guard entry.method == 8 else {
            throw MiniZipError.inflateFailed(path)
        }
        return try inflate(slice, expectedSize: entry.uncompressedSize, name: path)
    }

    /// Returns decompressed bytes decoded as a UTF-8 string.
    func string(for path: String) throws -> String? {
        guard let bytes = try data(for: path) else { return nil }
        return String(data: bytes, encoding: .utf8) ?? String(decoding: bytes, as: UTF8.self)
    }

    // MARK: - Parsing

    private mutating func parseCentralDirectory() throws {
        // Locate the End Of Central Directory record by scanning backwards for its signature.
        guard data.count >= 22 else { throw MiniZipError.notAZip }
        var eocd = -1
        let minStart = max(0, data.count - 22 - 65_535)
        var i = data.count - 22
        while i >= minStart {
            if readU32(i) == 0x06054b50 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw MiniZipError.notAZip }

        let entryCount = Int(readU16(eocd + 10))
        var p = Int(readU32(eocd + 16)) // central directory offset

        for _ in 0..<entryCount {
            guard p + 46 <= data.count, readU32(p) == 0x02014b50 else {
                throw MiniZipError.corrupt("bad central directory record")
            }
            let method = readU16(p + 10)
            let compressedSize = Int(readU32(p + 20))
            let uncompressedSize = Int(readU32(p + 24))
            let nameLen = Int(readU16(p + 28))
            let extraLen = Int(readU16(p + 30))
            let commentLen = Int(readU16(p + 32))
            let localOffset = Int(readU32(p + 42))

            let nameStart = p + 46
            guard nameStart + nameLen <= data.count else {
                throw MiniZipError.corrupt("bad file name length")
            }
            let name = String(decoding: data[nameStart..<nameStart + nameLen], as: UTF8.self)

            if !name.hasSuffix("/") {
                entries[name] = Entry(
                    method: method,
                    compressedSize: compressedSize,
                    uncompressedSize: uncompressedSize,
                    localHeaderOffset: localOffset
                )
            }
            p = nameStart + nameLen + extraLen + commentLen
        }
    }

    private func inflate(_ input: [UInt8], expectedSize: Int, name: String) throws -> Data {
        // Some producers leave the uncompressed size as 0 in the central directory; fall back
        // to a generous multiplier and grow if needed.
        var capacity = expectedSize > 0 ? expectedSize : max(input.count * 8, 4096)
        for _ in 0..<6 {
            let result = decode(input, capacity: capacity)
            if let result, result.count < capacity || result.count == expectedSize {
                return result
            }
            if expectedSize > 0, let result, result.count == expectedSize {
                return result
            }
            capacity *= 2
        }
        if let result = decode(input, capacity: capacity) { return result }
        throw MiniZipError.inflateFailed(name)
    }

    private func decode(_ input: [UInt8], capacity: Int) -> Data? {
        let destination = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
        defer { destination.deallocate() }
        let written = input.withUnsafeBufferPointer { src -> Int in
            compression_decode_buffer(
                destination, capacity,
                src.baseAddress!, src.count,
                nil, COMPRESSION_ZLIB
            )
        }
        guard written > 0 else { return nil }
        return Data(bytes: destination, count: written)
    }

    // MARK: - Little-endian readers

    private func readU16(_ offset: Int) -> UInt16 {
        UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
    }

    private func readU32(_ offset: Int) -> UInt32 {
        UInt32(data[offset]) |
        (UInt32(data[offset + 1]) << 8) |
        (UInt32(data[offset + 2]) << 16) |
        (UInt32(data[offset + 3]) << 24)
    }
}
