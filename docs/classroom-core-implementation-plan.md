# Polycast Classroom-Centered Implementation Plan

## How To Use This Document

- Treat this as the working implementation spec and progress tracker.
- Check items off as they are completed.
- Keep implementation notes under the relevant section rather than rewriting the whole plan.
- Preserve the product rules in this document unless they are intentionally changed in a later planning pass.

## Product Rules To Preserve

- [ ] `Home` remains the student landing page.
- [ ] Discovery stays visible and usable on `Home`.
- [ ] Browse/watch/discovery remain core parts of the app.
- [ ] Students can still use Polycast for self-directed learning outside assigned work.
- [ ] Assigned work is clearly labeled and prominent, but it does not replace discovery.
- [ ] Teacher-assigned work affects prioritization, not product access.

## Target Outcome

Polycast becomes classroom-centered without becoming closed-off. Teachers can assign structured language-learning work inside real classrooms, and students still have a blended `Home` that shows:

1. assigned work
2. review priority
3. in-progress learning
4. recommendations
5. outside discovery content

## Implementation Order

1. Real classrooms
2. Classroom items and assignments
3. Teacher create flows
4. Submission lifecycle
5. Blended student Home
6. Review-priority integration
7. Template bundles
8. Teacher review queue, gradebook, and progress

---

## Implementation 1: Introduce Real Classrooms

### Goal

Move from `teacher_id` ownership to true classroom ownership without breaking existing classwork.

### Current constraint

Today the app is effectively teacher-wide:

- `classroom_students(teacher_id, student_id)`
- `stream_posts.teacher_id`
- `stream_topics.teacher_id`

That has to change before classroom can be the product core.

### Work Checklist

- [ ] Add `classrooms` table
- [ ] Add `classroom_teachers` table
- [ ] Add classroom-scoped student membership table
- [ ] Add classroom-scoped topics table
- [ ] Generate classroom `class_code`
- [ ] Generate classroom invite-link token
- [ ] Add `archived` support on classrooms
- [ ] Add migration to create one default classroom for each teacher with existing classwork
- [ ] Migrate legacy teacher-student relationships into the default classroom
- [ ] Migrate legacy topics into classroom-scoped topics
- [ ] Add classroom APIs:
  - [ ] `GET /api/classrooms`
  - [ ] `POST /api/classrooms`
  - [ ] `GET /api/classrooms/:id`
  - [ ] `PATCH /api/classrooms/:id`
  - [ ] `GET /api/classrooms/:id/topics`
  - [ ] `POST /api/classrooms/:id/topics`
- [ ] Add classroom client API types:
  - [ ] `Classroom`
  - [ ] `ClassroomTeacher`
  - [ ] `ClassroomStudent`
  - [ ] `ClassroomTopic`
- [ ] Add compatibility layer so legacy classwork still resolves through the default classroom

### Acceptance Criteria

- [ ] Teachers can have one or more classrooms
- [ ] Student membership is classroom-specific
- [ ] Existing classwork still appears after migration
- [ ] No visible regression to current users

### Notes

- Existing legacy `stream_*` data should remain intact during migration.
- Compatibility is required until later implementations fully replace the old path.

---

## Implementation 2: Convert Classwork Posts Into Classroom Items + Assignments

### Goal

Replace the current overloaded `stream_post` model with a real classroom item and assignment structure.

### New Model

Top-level classroom items:

- `announcement`
- `material`
- `assignment`
- `question`
- `session`

Assignment subtypes:

- `video`
- `word_list`
- `quiz`
- `grammar_practice`
- `mixed`
- `writing`
- `external_tool`

### Work Checklist

- [ ] Add `classroom_items` table
- [ ] Add `assignments` table
- [ ] Add `assignment_targets` table
- [ ] Add publish-state model:
  - [ ] `draft`
  - [ ] `scheduled`
  - [ ] `published`
- [ ] Map current post types into the new model:
  - [ ] `material`
  - [ ] `lesson`
  - [ ] `word_list`
  - [ ] `class_session`
- [ ] Add APIs:
  - [ ] `GET /api/classrooms/:id/items`
  - [ ] `POST /api/classrooms/:id/items`
  - [ ] `PATCH /api/classrooms/:id/items/:itemId`
  - [ ] `DELETE /api/classrooms/:id/items/:itemId`
  - [ ] `POST /api/classrooms/:id/assignments`
  - [ ] `PATCH /api/classrooms/:id/assignments/:assignmentId`
- [ ] Add client types:
  - [ ] `ClassroomItem`
  - [ ] `Assignment`
  - [ ] `AssignmentTarget`
- [ ] Build classroom shell pages:
  - [ ] `ClassroomHome`
  - [ ] `ClassroomAssignments`
  - [ ] `ClassroomPeople`
  - [ ] `ClassroomProgress`
- [ ] Keep `Classwork.tsx` as a compatibility route during transition

### Acceptance Criteria

- [ ] Classroom content is class-scoped, not teacher-scoped
- [ ] Drafts and due dates exist in the model
- [ ] Legacy materials and word lists still appear
- [ ] Existing users do not lose access to prior content

---

## Implementation 3: Rebuild the Teacher Create Flow

### Goal

Give teachers a classroom-first content builder similar to Google Classroom, but centered on Polycast’s language-learning assets.

### Teacher Create Menu

- `Announcement`
- `Material`
- `Video assignment`
- `Word list assignment`
- `Quiz assignment`
- `Grammar practice`
- `Mixed assignment`
- `Question`
- `Session`
- `Reuse item`
- `Template bundle`
- `Topic`

### Work Checklist

- [ ] Add `CreateItemModal`
- [ ] Add `AssignmentSettingsPanel`
- [ ] Add `AssignmentAudienceSelector`
- [ ] Add `PublishControls`
- [ ] Add subtype editors:
  - [ ] `VideoAssignmentEditor`
  - [ ] `WordListAssignmentEditor`
  - [ ] `QuizAssignmentEditor`
  - [ ] `GrammarAssignmentEditor`
  - [ ] `MixedAssignmentEditor`
  - [ ] `MaterialEditor`
  - [ ] `QuestionEditor`
  - [ ] `SessionEditor`
- [ ] Support teacher workflow controls:
  - [ ] classroom selection
  - [ ] topic selection
  - [ ] assign-to-all
  - [ ] assign-to-selected-students
  - [ ] points
  - [ ] due date/time
  - [ ] draft
  - [ ] schedule
  - [ ] assign now
- [ ] Support attachment/content sources:
  - [ ] existing Polycast videos
  - [ ] links
  - [ ] PDFs/files
  - [ ] uploaded materials
  - [ ] internal quizzes
  - [ ] template bundles
- [ ] Add reuse-item flow

### Assignment-Type Requirements

#### Video assignment

- [ ] choose existing Polycast video
- [ ] optional clip range
- [ ] optional transcript-linked prompts
- [ ] optional required vocab targets
- [ ] optional comprehension questions

#### Word list assignment

- [ ] manual words
- [ ] import from template
- [ ] import from video transcript
- [ ] import from PDF/text
- [ ] set priority weight
- [ ] set mastery target

#### Quiz assignment

- [ ] choose existing quiz
- [ ] generate from video
- [ ] generate from word list
- [ ] generate from template
- [ ] support auto-grading where possible

#### Grammar practice

- [ ] choose grammar topic
- [ ] choose practice mode
- [ ] choose CEFR/difficulty

#### Mixed assignment

- [ ] sequence multiple blocks
- [ ] support video + vocab + quiz + prompt + material

### Acceptance Criteria

- [ ] Teachers can build all major assignment types
- [ ] Draft, schedule, and publish-now all work
- [ ] Teachers can assign to selected students
- [ ] Topics still organize work cleanly

---

## Implementation 4: Add Student Assignment Lifecycle + Submission Status

### Goal

Replace the current loose completion model with a real assignment lifecycle.

### Status Model

- `assigned`
- `in_progress`
- `submitted`
- `returned`
- `missing`
- `excused`

### Work Checklist

- [ ] Add `assignment_submissions` table
- [ ] Add `submission_artifacts` table
- [ ] Add `submission_events` table
- [ ] Add submission APIs:
  - [ ] `GET /api/assignments/:id/submissions`
  - [ ] `GET /api/assignments/:id/my-submission`
  - [ ] `POST /api/assignments/:id/submit`
  - [ ] `POST /api/assignments/:id/mark-in-progress`
  - [ ] `POST /api/submissions/:id/return`
  - [ ] `POST /api/submissions/:id/grade`
- [ ] Define subtype-specific submission rules:
  - [ ] video assignment
  - [ ] word list assignment
  - [ ] quiz assignment
  - [ ] grammar practice
  - [ ] question
  - [ ] writing assignment
- [ ] Build student assignment cards with:
  - [ ] status chip
  - [ ] due date
  - [ ] start/continue CTA
  - [ ] feedback/returned state
- [ ] Build teacher assignment detail view with:
  - [ ] grouped student statuses
  - [ ] quick counts
  - [ ] per-student review access

### Acceptance Criteria

- [ ] Every assignment has explicit student status
- [ ] Due/missing logic works
- [ ] Teachers can review submissions
- [ ] Students can clearly see assignment state

---

## Implementation 5: Rebuild Student Home As A Blended Dashboard

### Goal

Keep `Home` as the student landing page while making assigned work prominent and clearly marked.

### Required Home Sections

1. `Assigned To You`
2. `Review Priority`
3. `Continue Learning`
4. `Recommended For You`
5. `Browse New Content`

### Work Checklist

- [ ] Add student dashboard aggregation endpoint:
  - [ ] `GET /api/home/student-dashboard`
- [ ] Include in payload:
  - [ ] `assigned_due_soon`
  - [ ] `assigned_missing`
  - [ ] `review_priority`
  - [ ] `continue_learning`
  - [ ] `recommended_content`
  - [ ] `browse_content`
- [ ] Update `Home.tsx` to insert assignment sections above discovery
- [ ] Add clear assignment badges:
  - [ ] `Assigned`
  - [ ] `Due today`
  - [ ] `Missing`
  - [ ] `Teacher priority`
- [ ] Preserve current recommendation/discovery sections
- [ ] Keep browse/watch/content-entry paths intact

### Acceptance Criteria

- [ ] Students still see discovery on `Home`
- [ ] Assigned work is clearly visible above discovery
- [ ] Discovery content is not removed
- [ ] The app still supports self-directed exploration

---

## Implementation 6: Tie Assignments Into Review Prioritization

### Goal

Make teacher-assigned work affect what students review first.

### Priority Sources

- `teacher_assigned_required`
- `teacher_assigned_recommended`
- `student_unknown_from_assignment`
- `student_self_saved`
- `general_review_due`

### Work Checklist

- [ ] Add `assignment_word_targets`
- [ ] Add `student_assignment_word_state`
- [ ] Support student states:
  - [ ] `unknown`
  - [ ] `known_claimed`
  - [ ] `learning`
  - [ ] `mastered`
- [ ] Update review queue generation to prioritize teacher-assigned targets
- [ ] Add UI badges in dictionary/practice:
  - [ ] `Assigned in [Class]`
  - [ ] `Teacher priority`
- [ ] Add `I know this already` path for assigned words
- [ ] Preserve self-saved words and general review behavior
- [ ] Add assignment mastery target handling

### Acceptance Criteria

- [ ] Assigned words rise above generic backlog
- [ ] Students can mark assigned words as already known
- [ ] Teachers can still monitor assigned mastery
- [ ] Existing dictionary/practice still works outside assignments

---

## Implementation 7: Add Template Bundles And Curriculum Packs

### Goal

Let teachers assign whole lesson packages such as `ser vs estar` instead of assembling everything from scratch each time.

### Bundle Types

- `grammar`
- `vocabulary`
- `unit`
- `theme`
- `exam_prep`

### Work Checklist

- [ ] Add `template_bundles` model
- [ ] Add bundle asset support for:
  - [ ] videos
  - [ ] word lists
  - [ ] quizzes
  - [ ] grammar exercises
  - [ ] materials
  - [ ] prompts
- [ ] Add `TemplateBundlePicker`
- [ ] Add `TemplateBundlePreview`
- [ ] Add `TemplateAssignmentBuilder`
- [ ] Support teacher workflow:
  - [ ] choose bundle
  - [ ] preview assets
  - [ ] remove blocks
  - [ ] add extra blocks
  - [ ] assign to classes
  - [ ] assign to selected students
  - [ ] save customized draft
- [ ] Migrate or adapt current template system into bundle form

### Acceptance Criteria

- [ ] Teachers can assign a full bundle in one flow
- [ ] Teachers can customize bundle content before assigning
- [ ] Bundles convert into real classroom items and assignments

---

## Implementation 8: Add Teacher Review Queue, Gradebook, And Progress

### Goal

Complete the teacher loop so Polycast can be used operationally day to day.

### Work Checklist

- [ ] Build teacher `To Review` page across all classes
- [ ] Add filters:
  - [ ] class
  - [ ] topic
  - [ ] assignment type
  - [ ] status
  - [ ] student
- [ ] Build classroom gradebook
- [ ] Support:
  - [ ] students as rows
  - [ ] assignments as columns
  - [ ] inline grading
  - [ ] late/missing/resubmitted states
  - [ ] category totals
  - [ ] overall grade calculation
  - [ ] missing default grades
- [ ] Build class progress view
- [ ] Build student-in-class progress detail:
  - [ ] assigned work completion
  - [ ] missing work
  - [ ] word mastery by unit
  - [ ] grammar mastery by topic
  - [ ] video completion
  - [ ] recent activity
- [ ] Add assignment analytics:
  - [ ] completion rate
  - [ ] mastery rate
  - [ ] common misses
  - [ ] unknown vocabulary concentration
  - [ ] late-submission counts

### Acceptance Criteria

- [ ] Teachers can review work centrally
- [ ] Teachers can grade in one place
- [ ] Teachers can inspect student language progress, not just submission status
- [ ] Polycast feels operationally complete for real classroom use

---

## Cross-Cutting Public API / Type Additions

- [ ] `Classroom`
- [ ] `ClassroomTopic`
- [ ] `ClassroomItem`
- [ ] `Assignment`
- [ ] `AssignmentTarget`
- [ ] `AssignmentSubmission`
- [ ] `AssignmentStatus`
- [ ] `TemplateBundle`
- [ ] `StudentDashboard`
- [ ] `ReviewPriorityItem`
- [ ] `GradeEntry`
- [ ] `StudentClassProgress`

### Temporary Compatibility Types

- [ ] Keep `StreamPost` during transition
- [ ] Keep `StreamTopic` during transition
- [ ] Do not expand legacy types further than needed for compatibility

---

## Regression Checklist

- [ ] Browse still works
- [ ] Watch still works
- [ ] Discovery still works
- [ ] Students can still self-save words
- [ ] Dictionary still works outside assignments
- [ ] Practice still works outside assignments
- [ ] Home discovery sections are still present
- [ ] Existing classwork content is not lost during migration

---

## Suggested Milestones

### Milestone 1

- [ ] Implementations 1 and 2 complete
- [ ] Real classrooms exist
- [ ] Legacy classwork is migrated/compatibility-backed

### Milestone 2

- [ ] Implementations 3 and 4 complete
- [ ] Teachers can create real assignments
- [ ] Students have real statuses and submissions

### Milestone 3

- [ ] Implementations 5 and 6 complete
- [ ] Student `Home` is blended
- [ ] Assigned content drives review priority

### Milestone 4

- [ ] Implementations 7 and 8 complete
- [ ] Template bundles exist
- [ ] Teacher review and grade workflows are operational

---

## Working Notes

### Key Principle

Polycast should become “Google Classroom plus language-learning intelligence,” not “a generic LMS that happens to contain language content.”

### Important Architectural Rule

Classrooms become the ownership boundary for coursework, but `Home` remains the student-facing front door.

