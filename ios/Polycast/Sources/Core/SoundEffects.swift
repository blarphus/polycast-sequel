@preconcurrency import AVFoundation

final class SoundEffects: @unchecked Sendable {
    static let shared = SoundEffects()

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let sampleRate: Double = 44100
    private let format: AVAudioFormat

    private init() {
        format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 1.0
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, options: .mixWithOthers)
            try AVAudioSession.sharedInstance().setActive(true)
            try engine.start()
        } catch {
            PolycastLog.runtime.error("[SoundEffects] Failed to start audio engine: \(error)")
        }
    }

    private func ensureRunning() {
        if !engine.isRunning {
            do {
                try AVAudioSession.sharedInstance().setCategory(.playback, options: .mixWithOthers)
                try AVAudioSession.sharedInstance().setActive(true)
                try engine.start()
            } catch {
                PolycastLog.runtime.error("[SoundEffects] Failed to restart engine: \(error)")
            }
        }
    }

    // MARK: - Tone Generation

    private enum Waveform {
        case sine, triangle
    }

    /// Mix multiple tones into a single buffer, each starting at its delay offset.
    private func makeMixedBuffer(_ tones: [(frequency: Double, delay: Double, duration: Double, amplitude: Float, waveform: Waveform)]) -> AVAudioPCMBuffer? {
        // Total length = max(delay + duration) across all tones
        var totalSeconds: Double = 0
        for tone in tones {
            totalSeconds = max(totalSeconds, tone.delay + tone.duration)
        }
        let totalFrames = AVAudioFrameCount(sampleRate * totalSeconds) + 1
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: totalFrames) else { return nil }
        buffer.frameLength = totalFrames
        guard let data = buffer.floatChannelData?[0] else { return nil }

        // Zero out
        for i in 0..<Int(totalFrames) { data[i] = 0 }

        // Add each tone
        for tone in tones {
            let startFrame = Int(tone.delay * sampleRate)
            let frameCount = Int(tone.duration * sampleRate)
            let attackFrames = Int(sampleRate * 0.01)
            let decayStart = Int(Double(frameCount) * 0.6)

            for i in 0..<frameCount {
                let outIdx = startFrame + i
                guard outIdx < Int(totalFrames) else { break }

                let t = Double(i) / sampleRate
                let phase = 2.0 * .pi * tone.frequency * t

                let sample: Float
                switch tone.waveform {
                case .sine:
                    sample = Float(sin(phase))
                case .triangle:
                    let p = (tone.frequency * t).truncatingRemainder(dividingBy: 1.0)
                    sample = Float(p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p)
                }

                var envelope: Float = tone.amplitude
                if i < attackFrames {
                    envelope *= Float(i) / Float(attackFrames)
                } else if i > decayStart {
                    let progress = Float(i - decayStart) / Float(frameCount - decayStart)
                    envelope *= 1.0 - progress
                }
                data[outIdx] += sample * envelope
            }
        }
        return buffer
    }

    private func play(_ tones: [(frequency: Double, delay: Double, duration: Double, amplitude: Float, waveform: Waveform)]) {
        ensureRunning()
        guard let buffer = makeMixedBuffer(tones) else { return }
        player.stop()
        player.scheduleBuffer(buffer)
        player.play()
    }

    // MARK: - Public API

    /// Warm ascending 4-note arpeggio (C5->E5->G5->C6, ~400ms)
    func playCorrect() {
        play([
            (frequency: 523.25, delay: 0, duration: 0.12, amplitude: 0.08, waveform: .triangle),
            (frequency: 659.25, delay: 0.07, duration: 0.15, amplitude: 0.11, waveform: .sine),
            (frequency: 783.99, delay: 0.14, duration: 0.19, amplitude: 0.13, waveform: .sine),
            (frequency: 1046.5, delay: 0.15, duration: 0.13, amplitude: 0.035, waveform: .triangle),
        ])
    }

    /// Soft descending 3-note (E4->B3->G3, ~350ms)
    func playIncorrect() {
        play([
            (frequency: 329.63, delay: 0, duration: 0.10, amplitude: 0.09, waveform: .triangle),
            (frequency: 246.94, delay: 0.075, duration: 0.14, amplitude: 0.07, waveform: .sine),
            (frequency: 196.0, delay: 0.15, duration: 0.17, amplitude: 0.06, waveform: .triangle),
        ])
    }

    /// Celebratory ascending chime (~500ms)
    func playComplete() {
        play([
            (frequency: 523.25, delay: 0, duration: 0.15, amplitude: 0.08, waveform: .triangle),
            (frequency: 659.25, delay: 0.11, duration: 0.15, amplitude: 0.10, waveform: .triangle),
            (frequency: 783.99, delay: 0.22, duration: 0.17, amplitude: 0.12, waveform: .triangle),
            (frequency: 1046.5, delay: 0.34, duration: 0.23, amplitude: 0.08, waveform: .sine),
        ])
    }
}
