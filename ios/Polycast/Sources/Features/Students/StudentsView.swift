import SwiftUI
import Combine

struct StudentsView: View {
    @EnvironmentObject private var session: SessionStore

    @State private var classrooms: [Classroom] = []
    @State private var selectedClassroomId: String?
    @State private var roster: [ClassroomStudent] = []
    @State private var searchQuery = ""
    @State private var searchResults: [UserSearchResult] = []
    @State private var addedIds: Set<String> = []
    @State private var loading = true
    @State private var rosterLoading = false
    @State private var error = ""

    private let api = APIClient.shared

    private var isTeacher: Bool {
        session.user?.accountType == "teacher"
    }

    private var activeClassroom: Classroom? {
        classrooms.first { $0.id == selectedClassroomId }
    }

    var body: some View {
        Group {
            if loading && classrooms.isEmpty {
                LoadingStateView(title: "Loading classrooms...")
                    .frame(maxHeight: .infinity)
            } else if classrooms.isEmpty {
                EmptyStateView(
                    title: "No classrooms",
                    subtitle: "Create a classroom on the web app to get started."
                )
                .padding()
                .frame(maxHeight: .infinity)
            } else {
                mainContent
            }
        }
        .texturedBackground()
        .navigationTitle("Students")
        .task {
            await loadClassrooms()
        }
        .refreshable {
            await loadClassrooms()
            if let id = selectedClassroomId {
                await loadRoster(classroomId: id)
            }
        }
    }

    private var mainContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Classroom picker
                classroomPicker

                if !error.isEmpty {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                // Add students section (teacher only)
                if isTeacher, activeClassroom != nil {
                    addStudentsSection
                }

                // Roster
                rosterSection
            }
            .padding(.vertical)
        }
    }

    // MARK: - Classroom Picker

    private var classroomPicker: some View {
        HStack {
            Text("Class")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Picker("Classroom", selection: $selectedClassroomId) {
                ForEach(classrooms) { classroom in
                    Text(classroom.name).tag(Optional(classroom.id))
                }
            }
            .pickerStyle(.menu)
            .tint(.purple)
        }
        .padding(.horizontal)
        .onChange(of: selectedClassroomId) {
            guard let id = selectedClassroomId else { return }
            searchQuery = ""
            searchResults = []
            Task { await loadRoster(classroomId: id) }
        }
    }

    // MARK: - Add Students

    private var addStudentsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "plus")
                    .font(.footnote.weight(.bold))
                Text("Add students")
                    .font(.subheadline.weight(.semibold))
            }
            .foregroundStyle(.secondary)

            if let code = activeClassroom?.classCode, !code.isEmpty {
                HStack(spacing: 8) {
                    Text("Class code:")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(code)
                        .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                    Button("Copy") {
                        UIPasteboard.general.string = code
                    }
                    .font(.caption.weight(.medium))
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .tint(.purple)
                }
            }

            TextField("Search by username...", text: $searchQuery)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: searchQuery) {
                    debounceSearch()
                }

            if !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty {
                if searchResults.isEmpty {
                    Text("No students found")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(searchResults) { user in
                        searchResultRow(user)
                    }
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal)
    }

    private func searchResultRow(_ user: UserSearchResult) -> some View {
        HStack(spacing: 12) {
            initialsCircle(user.displayName ?? user.username)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName ?? user.username)
                    .font(.subheadline.weight(.medium))
                Text("@\(user.username)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if addedIds.contains(user.id) {
                Text("Added")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            } else {
                Button("Add") {
                    Task { await addStudent(user.id) }
                }
                .font(.caption.weight(.medium))
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(.purple)
            }
        }
    }

    // MARK: - Roster

    private var rosterSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(
                activeClassroom?.name ?? "Students",
                subtitle: "\(roster.count) student\(roster.count == 1 ? "" : "s")"
            )
            .padding(.horizontal)

            if rosterLoading {
                LoadingStateView(title: "Loading roster...")
                    .frame(height: 120)
            } else if roster.isEmpty {
                EmptyStateView(
                    title: "No students yet",
                    subtitle: isTeacher
                        ? "Search above to add students."
                        : "No classmates in this class yet."
                )
                .padding(.horizontal)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(roster) { student in
                        NavigationLink {
                            StudentDetailView(
                                classroomId: selectedClassroomId ?? "",
                                studentId: student.id,
                                studentName: student.displayName ?? student.username
                            )
                        } label: {
                            rosterRow(student)
                        }
                        .buttonStyle(.plain)

                        if student.id != roster.last?.id {
                            Divider().padding(.leading, 68)
                        }
                    }
                }
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)
            }
        }
    }

    private func rosterRow(_ student: ClassroomStudent) -> some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                initialsCircle(student.displayName ?? student.username)
                if student.online {
                    Circle()
                        .fill(.green)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(student.displayName ?? student.username)
                    .font(.subheadline.weight(.medium))
                Text("@\(student.username)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .swipeActions(edge: .trailing) {
            if isTeacher {
                Button(role: .destructive) {
                    Task { await removeStudent(student.id) }
                } label: {
                    Label("Remove", systemImage: "trash")
                }
            }
        }
    }

    // MARK: - Helpers

    private func initialsCircle(_ name: String) -> some View {
        let initials = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        let display = initials.isEmpty ? String(name.prefix(1)).uppercased() : initials.uppercased()
        return Text(display)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .background(Color.purple.opacity(0.7), in: Circle())
    }

    // MARK: - Data Loading

    private func loadClassrooms() async {
        do {
            let result = try await api.classrooms()
            classrooms = result
            if selectedClassroomId == nil, let first = result.first {
                selectedClassroomId = first.id
                await loadRoster(classroomId: first.id)
            }
        } catch {
            self.error = error.localizedDescription
            print("[Polycast] StudentsView loadClassrooms error: \(error)")
        }
        loading = false
    }

    private func loadRoster(classroomId: String) async {
        rosterLoading = true
        do {
            let students = try await api.getClassroomStudents(classroomId: classroomId)
            roster = students
            addedIds = Set(students.map(\.id))
            self.error = ""
        } catch {
            self.error = error.localizedDescription
            print("[Polycast] StudentsView loadRoster error: \(error)")
        }
        rosterLoading = false
    }

    @State private var searchTask: Task<Void, Never>?

    private func debounceSearch() {
        searchTask?.cancel()
        let query = searchQuery.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else {
            searchResults = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            do {
                let results = try await api.searchUsers(query: query)
                if !Task.isCancelled {
                    searchResults = results
                }
            } catch {
                print("[Polycast] Student search error: \(error)")
            }
        }
    }

    private func addStudent(_ studentId: String) async {
        guard let classroomId = selectedClassroomId else { return }
        do {
            try await api.addClassroomStudent(classroomId: classroomId, studentId: studentId)
            addedIds.insert(studentId)
            await loadRoster(classroomId: classroomId)
        } catch {
            self.error = error.localizedDescription
            print("[Polycast] Add student error: \(error)")
        }
    }

    private func removeStudent(_ studentId: String) async {
        guard let classroomId = selectedClassroomId else { return }
        do {
            try await api.removeClassroomStudent(classroomId: classroomId, studentId: studentId)
            roster.removeAll { $0.id == studentId }
            addedIds.remove(studentId)
        } catch {
            self.error = error.localizedDescription
            print("[Polycast] Remove student error: \(error)")
        }
    }
}
