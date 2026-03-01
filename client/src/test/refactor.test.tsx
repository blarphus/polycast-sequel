// ---------------------------------------------------------------------------
// Comprehensive tests for the Classwork.tsx + main.css refactor
// Verifies: module structure, exports, CSS partials, component rendering
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// 1. CSS Split — all 12 partial files exist and main.css imports them
// ---------------------------------------------------------------------------

describe('CSS split', () => {
  const stylesDir = path.resolve(__dirname, '../styles');

  const expectedPartials = [
    'base.css',
    'chat.css',
    'social.css',
    'call.css',
    'home.css',
    'dictionary.css',
    'settings.css',
    'learn.css',
    'classwork.css',
    'students.css',
    'theme.css',
    'responsive.css',
  ];

  it.each(expectedPartials)('partial %s exists', (file) => {
    const full = path.join(stylesDir, file);
    expect(fs.existsSync(full)).toBe(true);
  });

  it.each(expectedPartials)('partial %s is non-empty', (file) => {
    const content = fs.readFileSync(path.join(stylesDir, file), 'utf-8');
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it('main.css consists only of @import directives', () => {
    const mainCss = fs.readFileSync(path.join(stylesDir, 'main.css'), 'utf-8');
    const lines = mainCss.split('\n').filter((l) => l.trim() && !l.trim().startsWith('/*'));
    for (const line of lines) {
      expect(line.trim()).toMatch(/^@import\s+'.\/[\w-]+\.css';$/);
    }
  });

  it('main.css imports every expected partial', () => {
    const mainCss = fs.readFileSync(path.join(stylesDir, 'main.css'), 'utf-8');
    for (const file of expectedPartials) {
      expect(mainCss).toContain(`@import './${file}';`);
    }
  });

  it('base.css contains the :root CSS variables', () => {
    const content = fs.readFileSync(path.join(stylesDir, 'base.css'), 'utf-8');
    expect(content).toContain(':root');
    expect(content).toContain('--bg-primary');
    expect(content).toContain('--accent');
    expect(content).toContain('--font');
  });

  it('theme.css contains dark theme overrides', () => {
    const content = fs.readFileSync(path.join(stylesDir, 'theme.css'), 'utf-8');
    expect(content).toContain('[data-theme="dark"]');
    expect(content).toContain('--bg-primary: #0f0f0f');
  });

  it('theme.css contains background texture overlays', () => {
    const content = fs.readFileSync(path.join(stylesDir, 'theme.css'), 'utf-8');
    expect(content).toContain('[data-bg-texture="dots"]');
    expect(content).toContain('[data-bg-texture="lines"]');
    expect(content).toContain('[data-bg-texture="noise"]');
    expect(content).toContain('[data-bg-texture="grid"]');
  });

  it('responsive.css contains @media queries', () => {
    const content = fs.readFileSync(path.join(stylesDir, 'responsive.css'), 'utf-8');
    expect(content).toContain('@media');
    expect(content).toContain('max-width: 600px');
  });

  it('classwork.css contains stream/classwork classes', () => {
    const content = fs.readFileSync(path.join(stylesDir, 'classwork.css'), 'utf-8');
    expect(content).toContain('.classwork-page');
    expect(content).toContain('.stream-post-card');
    expect(content).toContain('.stream-topic-section');
    expect(content).toContain('.stream-create-btn');
  });

  it('students.css contains students and sidebar classes', () => {
    const content = fs.readFileSync(path.join(stylesDir, 'students.css'), 'utf-8');
    expect(content).toContain('.students-page');
    expect(content).toContain('.student-detail-page');
    expect(content).toContain('.bottom-toolbar');
    expect(content).toContain('.sidebar-brand');
  });

  it('learn.css contains flashcard classes', () => {
    const content = fs.readFileSync(path.join(stylesDir, 'learn.css'), 'utf-8');
    expect(content).toContain('.learn-page');
    expect(content).toContain('.flashcard');
    expect(content).toContain('.flashcard-flip-wrapper');
  });

  it('dictionary.css contains dictionary classes', () => {
    const content = fs.readFileSync(path.join(stylesDir, 'dictionary.css'), 'utf-8');
    expect(content).toContain('.dict-list');
    expect(content).toContain('.dict-item');
    expect(content).toContain('.dict-due-badge');
  });

  it('no duplicate CSS rules across partials (spot-check key selectors)', () => {
    const partialMap = Object.fromEntries(
      expectedPartials.map((f) => [f, fs.readFileSync(path.join(stylesDir, f), 'utf-8')]),
    );

    // .classwork-page base definition lives in classwork.css
    expect(partialMap['classwork.css']).toContain('.classwork-page {');

    // .learn-page base definition lives in learn.css
    expect(partialMap['learn.css']).toContain('.learn-page {');

    // :root should only be in base.css
    const filesWithRoot = Object.values(partialMap).filter((c) => c.includes(':root {'));
    expect(filesWithRoot.length).toBe(1);

    // Dark theme variable overrides only in theme.css
    const filesWithDarkVars = Object.entries(partialMap).filter(
      ([, c]) => c.includes('--bg-primary: #0f0f0f'),
    );
    expect(filesWithDarkVars.length).toBe(1);
    expect(filesWithDarkVars[0][0]).toBe('theme.css');
  });
});

// ---------------------------------------------------------------------------
// 2. Component Module Structure — exports exist with correct shapes
// ---------------------------------------------------------------------------

describe('Classwork component module structure', () => {
  it('CreatePostModal exports the expected symbols', async () => {
    const mod = await import('../components/classwork/CreatePostModal');
    expect(mod.LANGUAGES).toBeDefined();
    expect(Array.isArray(mod.LANGUAGES)).toBe(true);
    expect(mod.LANGUAGES.length).toBeGreaterThan(0);
    expect(mod.LANGUAGES[0]).toHaveProperty('code');
    expect(mod.LANGUAGES[0]).toHaveProperty('name');
    expect(typeof mod.AttachmentEditor).toBe('function');
    expect(typeof mod.LessonItemEditor).toBe('function');
    expect(typeof mod.CreatePostModal).toBe('function');
    expect(typeof mod.CreateMenu).toBe('function');
  });

  it('EditModal has a default export', async () => {
    const mod = await import('../components/classwork/EditModal');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('PostCards exports the expected card components', async () => {
    const mod = await import('../components/classwork/PostCards');
    expect(typeof mod.TeacherPostCard).toBe('function');
    expect(typeof mod.StudentWordListCard).toBe('function');
    expect(typeof mod.StudentMaterialCard).toBe('function');
    expect(typeof mod.StudentLessonCard).toBe('function');
  });

  it('TopicSection exports TopicSection', async () => {
    const mod = await import('../components/classwork/TopicSection');
    expect(typeof mod.TopicSection).toBe('function');
  });

  it('Classwork page default-exports a function component', async () => {
    const mod = await import('../pages/Classwork');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 3. Component Rendering — shallow render with mocked dependencies
// ---------------------------------------------------------------------------

// Mock the api module
vi.mock('../api', () => ({
  getStream: vi.fn().mockResolvedValue({ topics: [], posts: [] }),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  createPost: vi.fn(),
  createTopic: vi.fn(),
  renameTopic: vi.fn(),
  deleteTopic: vi.fn(),
  reorderPosts: vi.fn(),
  reorderTopics: vi.fn(),
  markKnown: vi.fn(),
}));

// Mock useAuth
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'test-user-id',
      username: 'testteacher',
      display_name: 'Test Teacher',
      account_type: 'teacher',
      native_language: 'en',
      target_language: 'es',
      daily_new_limit: 20,
    },
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    updateSettings: vi.fn(),
  }),
}));

// Mock ImagePicker and WordLookupModal (used by CreatePostModal)
vi.mock('../components/ImagePicker', () => ({
  default: () => <div data-testid="image-picker-mock" />,
}));

vi.mock('../components/WordLookupModal', () => ({
  default: () => <div data-testid="word-lookup-mock" />,
}));

// Mock renderTildeHighlight
vi.mock('../utils/tildeMarkup', () => ({
  renderTildeHighlight: (text: string) => text,
}));

describe('EditModal rendering', () => {
  const mockPost = {
    id: 'post-1',
    teacher_id: 'teacher-1',
    type: 'material' as const,
    title: 'Test Material',
    body: 'Test body content',
    attachments: [{ url: 'https://example.com', label: 'Example' }],
    target_language: 'es',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    topic_id: null,
    position: 0,
    words: [],
    known_word_ids: [],
  };

  it('renders title input with post title', async () => {
    const EditModal = (await import('../components/classwork/EditModal')).default;
    render(<EditModal post={mockPost} onSave={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByDisplayValue('Test Material');
    expect(input).toBeInTheDocument();
  });

  it('renders body textarea for material posts', async () => {
    const EditModal = (await import('../components/classwork/EditModal')).default;
    render(<EditModal post={mockPost} onSave={vi.fn()} onClose={vi.fn()} />);
    const textarea = screen.getByDisplayValue('Test body content');
    expect(textarea).toBeInTheDocument();
  });

  it('renders attachment row', async () => {
    const EditModal = (await import('../components/classwork/EditModal')).default;
    render(<EditModal post={mockPost} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('renders Save and Cancel buttons', async () => {
    const EditModal = (await import('../components/classwork/EditModal')).default;
    render(<EditModal post={mockPost} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const EditModal = (await import('../components/classwork/EditModal')).default;
    const onClose = vi.fn();
    render(<EditModal post={mockPost} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders lesson item editors for lesson posts', async () => {
    const lessonPost = {
      ...mockPost,
      type: 'lesson' as const,
      body: null,
      attachments: [],
      lesson_items: [
        { title: 'Item One', body: 'Notes one', attachments: [] },
        { title: 'Item Two', body: 'Notes two', attachments: [] },
      ],
    };
    const EditModal = (await import('../components/classwork/EditModal')).default;
    render(<EditModal post={lessonPost} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByDisplayValue('Item One')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Item Two')).toBeInTheDocument();
  });
});

describe('AttachmentEditor rendering', () => {
  it('renders existing attachments', async () => {
    const { AttachmentEditor } = await import('../components/classwork/CreatePostModal');
    const attachments = [
      { url: 'https://a.com', label: 'Link A' },
      { url: 'https://b.com', label: 'Link B' },
    ];
    render(<AttachmentEditor attachments={attachments} onChange={vi.fn()} />);
    expect(screen.getByText('Link A')).toBeInTheDocument();
    expect(screen.getByText('Link B')).toBeInTheDocument();
  });

  it('adds a new attachment via the link form', async () => {
    const { AttachmentEditor } = await import('../components/classwork/CreatePostModal');
    const onChange = vi.fn();
    render(<AttachmentEditor attachments={[]} onChange={onChange} />);
    // Click "+ Add Link" to show the form
    fireEvent.click(screen.getByText('+ Add Link'));
    // Fill in the URL
    const urlInput = screen.getByPlaceholderText('https://…');
    fireEvent.change(urlInput, { target: { value: 'https://new.com' } });
    // Submit
    fireEvent.click(screen.getByText('Add Link'));
    expect(onChange).toHaveBeenCalledWith([{ url: 'https://new.com', label: 'https://new.com' }]);
  });
});

describe('StudentMaterialCard rendering', () => {
  it('renders material post title and body', async () => {
    const { StudentMaterialCard } = await import('../components/classwork/PostCards');
    const post = {
      id: 'p1',
      teacher_id: 't1',
      type: 'material' as const,
      title: 'Material Title',
      body: 'Material body text',
      attachments: [],
      target_language: 'es',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      topic_id: null,
      position: 0,
      words: [],
      known_word_ids: [],
    };
    render(<StudentMaterialCard post={post} />);
    expect(screen.getByText('Material Title')).toBeInTheDocument();
    expect(screen.getByText('Material body text')).toBeInTheDocument();
  });
});

describe('StudentLessonCard rendering', () => {
  it('renders lesson post with lesson items', async () => {
    const { StudentLessonCard } = await import('../components/classwork/PostCards');
    const post = {
      id: 'p2',
      teacher_id: 't1',
      type: 'lesson' as const,
      title: 'Lesson Title',
      body: null,
      attachments: [],
      lesson_items: [
        { title: 'Step 1', body: 'Do this first', attachments: [] },
      ],
      target_language: 'es',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      topic_id: null,
      position: 0,
      words: [],
      known_word_ids: [],
    };
    render(<StudentLessonCard post={post} />);
    expect(screen.getByText('Lesson Title')).toBeInTheDocument();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Do this first')).toBeInTheDocument();
  });
});

describe('LANGUAGES constant', () => {
  it('contains common languages', async () => {
    const { LANGUAGES } = await import('../components/classwork/CreatePostModal');
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('es');
    expect(codes).toContain('fr');
    expect(codes).toContain('de');
    expect(codes).toContain('ja');
    expect(codes).toContain('ko');
    expect(codes).toContain('zh');
  });

  it('has unique codes', async () => {
    const { LANGUAGES } = await import('../components/classwork/CreatePostModal');
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ---------------------------------------------------------------------------
// 4. File structure — classwork directory has exactly the expected files
// ---------------------------------------------------------------------------

describe('Classwork component directory structure', () => {
  const classworkDir = path.resolve(__dirname, '../components/classwork');

  const expectedFiles = [
    'CreatePostModal.tsx',
    'EditModal.tsx',
    'PostCards.tsx',
    'TopicSection.tsx',
    'WordListTab.tsx',
    'languages.ts',
  ];

  it.each(expectedFiles)('file %s exists', (file) => {
    expect(fs.existsSync(path.join(classworkDir, file))).toBe(true);
  });

  it('contains exactly the expected files (no stray files)', () => {
    const actualFiles = fs.readdirSync(classworkDir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
    expect(actualFiles.sort()).toEqual(expectedFiles.sort());
  });
});

// ---------------------------------------------------------------------------
// 5. Classwork.tsx orchestrator imports — verify it uses extracted modules
// ---------------------------------------------------------------------------

describe('Classwork.tsx orchestrator', () => {
  it('imports from the classwork sub-modules', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../pages/Classwork.tsx'),
      'utf-8',
    );
    expect(src).toContain("from '../components/classwork/CreatePostModal'");
    expect(src).toContain("from '../components/classwork/EditModal'");
    expect(src).toContain("from '../components/classwork/TopicSection'");
  });

  it('does not contain inline component definitions that were extracted', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../pages/Classwork.tsx'),
      'utf-8',
    );
    // These components were extracted — they should NOT be defined in the orchestrator
    expect(src).not.toContain('function AttachmentEditor');
    expect(src).not.toContain('function MaterialTab');
    expect(src).not.toContain('function LessonTab');
    expect(src).not.toContain('function WordListTab');
    expect(src).not.toContain('function TeacherPostCard');
    expect(src).not.toContain('function StudentWordListCard');
    expect(src).not.toContain('function TopicSection');
    expect(src).not.toContain('function TopicMenu');
    expect(src).not.toContain('function PostMenu');
    expect(src).not.toContain('function CreateMenu');
  });

  it('still exports a default function component', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../pages/Classwork.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export default function Classwork/);
  });
});
