#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'contracts/srs-v1.json');
const fixturePath = path.join(root, 'contracts/srs-v1.fixtures.json');
const contractRaw = await readFile(contractPath, 'utf8');
const fixtureRaw = await readFile(fixturePath, 'utf8');
const contract = JSON.parse(contractRaw);
const fixtures = JSON.parse(fixtureRaw);
const sourceHash = createHash('sha256').update(`${contractRaw}\n${fixtureRaw}`).digest('hex');
const apiContractRaw = await readFile(path.join(root, 'contracts/api-v1.openapi.json'), 'utf8');
const apiFixtureRaw = await readFile(path.join(root, 'contracts/api-v1.fixtures.json'), 'utf8');
const apiContract = JSON.parse(apiContractRaw);
const apiFixtures = JSON.parse(apiFixtureRaw);
const fallbackContract = JSON.parse(await readFile(path.join(root, 'contracts/fallback-diagnostic.schema.json'), 'utf8'));
let apiSourceHash;
const languagesRaw = await readFile(path.join(root, 'contracts/languages-v1.json'), 'utf8');
const languagesContract = JSON.parse(languagesRaw);
const languagesSourceHash = createHash('sha256').update(languagesRaw).digest('hex');
const extensionMessagesRaw = await readFile(path.join(root, 'contracts/extension-messages-v1.json'), 'utf8');
const extensionMessagesContract = JSON.parse(extensionMessagesRaw);
const extensionMessagesSourceHash = createHash('sha256').update(extensionMessagesRaw).digest('hex');
if (extensionMessagesContract.version !== 1 || !Number.isInteger(extensionMessagesContract.maxBytes) || !extensionMessagesContract.messages) {
  throw new Error('Invalid extension messages v1 contract');
}
const extensionMessageTypes = Object.keys(extensionMessagesContract.messages);
apiSourceHash = createHash('sha256').update(`${apiContractRaw}\n${apiFixtureRaw}\n${extensionMessagesRaw}`).digest('hex');
const transcriptFixturesRaw = await readFile(path.join(root, 'contracts/transcript-tokenization-v1.fixtures.json'), 'utf8');
const transcriptFixtures = JSON.parse(transcriptFixturesRaw);
const transcriptFixturesSourceHash = createHash('sha256').update(transcriptFixturesRaw).digest('hex');
if (transcriptFixtures.version !== 1 || !transcriptFixtures.tokenization?.length || !transcriptFixtures.srt?.length) {
  throw new Error('Invalid transcript/tokenization v1 fixtures');
}
if (languagesContract.version !== 1 || !Array.isArray(languagesContract.languages) || !Array.isArray(languagesContract.cefrLevels)) {
  throw new Error('Invalid languages v1 contract');
}
const languageCodes = new Set();
for (const language of languagesContract.languages) {
  if (!/^[a-z]{2,3}$/.test(language.code) || !language.name || languageCodes.has(language.code)) throw new Error(`Invalid/duplicate language: ${language.code}`);
  languageCodes.add(language.code);
}

function assertExactFields(value, required, label) {
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields differ from contract: expected ${expected.join(', ')}, got ${keys.join(', ')}`);
  }
}

const apiAuthRequired = apiContract.components?.schemas?.AuthUser?.required;
if (!Array.isArray(apiAuthRequired) || apiContract.openapi !== '3.1.0') throw new Error('Invalid API v1 OpenAPI contract');
assertExactFields(apiFixtures.authUser, apiAuthRequired, 'authUser fixture');
assertExactFields(apiFixtures.authSession, apiContract.components.schemas.AuthSession.required, 'authSession fixture');
if (!['student', 'teacher'].includes(apiFixtures.authUser.account_type)) throw new Error('Invalid auth fixture role');
assertExactFields(apiFixtures.fallbackDiagnostic, fallbackContract.required.concat(['detail']), 'fallbackDiagnostic fixture');
assertExactFields(apiFixtures.transcriptResponse, apiContract.components.schemas.TranscriptResponse.required, 'transcriptResponse fixture');
assertExactFields(apiFixtures.transcriptResponse.segments[0], apiContract.components.schemas.TranscriptSegment.required, 'transcriptSegment fixture');
assertExactFields(apiFixtures.transcriptResponse.segments[0].words[0], apiContract.components.schemas.TranscriptWord.required, 'transcriptWord fixture');
assertExactFields(apiFixtures.groupCallSignal, apiContract.components.schemas.GroupCallSignal.required, 'groupCallSignal fixture');
assertExactFields(apiFixtures.callSignal, apiContract.components.schemas.CallSignal.required, 'callSignal fixture');
assertExactFields(apiFixtures.extensionMessage, [...apiContract.components.schemas.ExtensionMessage.required, 'hostname'], 'extensionMessage fixture');
for (const schemaName of ['AuthUser', 'AuthSession', 'TranscriptWord', 'TranscriptSegment', 'TranscriptResponse', 'SocketEnvelope', 'CallSignal', 'GroupCallSignal', 'ExtensionMessage']) {
  if (apiContract.components.schemas[schemaName].additionalProperties !== false) {
    throw new Error(`${schemaName} must reject undocumented extra fields`);
  }
}

function assertContract() {
  if (contract.version !== 1 || contract.algorithmVersion !== 'srs-v1') throw new Error('Unsupported SRS contract version');
  if (!Number.isInteger(contract.maxPromptStage) || contract.maxPromptStage < 3) throw new Error('Invalid maxPromptStage');
  if (!Array.isArray(contract.learningStepsSeconds) || contract.learningStepsSeconds.some((v) => !Number.isInteger(v) || v <= 0)) throw new Error('Invalid learning steps');
  if (!Array.isArray(fixtures.cases) || fixtures.cases.length === 0) throw new Error('SRS fixtures must not be empty');
  for (const fixture of fixtures.cases) {
    if (!fixture.name || !['again', 'good'].includes(fixture.answer)) throw new Error(`Invalid fixture: ${fixture.name || '<unnamed>'}`);
    for (const key of ['srs_interval', 'ease_factor', 'learning_step', 'prompt_stage']) {
      if (!(key in fixture.card)) throw new Error(`Fixture ${fixture.name} missing card.${key}`);
    }
  }
}
assertContract();

const banner = `// Generated by scripts/generate-contracts.mjs from contracts/srs-v1*.json.\n// Source SHA-256: ${sourceHash}\n// Do not edit by hand.\n`;
const jsBody = `${banner}
export const SRS_SOURCE_HASH = '${sourceHash}';
export const SRS_ALGORITHM_VERSION = '${contract.algorithmVersion}';
export const MAX_PROMPT_STAGE = ${contract.maxPromptStage};
export const LEARNING_STEPS = Object.freeze(${JSON.stringify(contract.learningStepsSeconds)});
export const GRADUATING_INTERVAL = ${contract.graduatingIntervalSeconds};
export const MIN_REVIEW_INTERVAL = ${contract.minimumReviewIntervalSeconds};
export const MIN_EASE = ${contract.minimumEaseFactor};
export const SRS_GOLDEN_FIXTURES = Object.freeze(${JSON.stringify(fixtures.cases, null, 2)});
`;

const tsBody = `${banner}
export type SrsAnswer = 'again' | 'good';
export const SRS_SOURCE_HASH = '${sourceHash}' as const;
export const SRS_ALGORITHM_VERSION = '${contract.algorithmVersion}' as const;
export const MAX_PROMPT_STAGE = ${contract.maxPromptStage} as const;
export const LEARNING_STEPS = ${JSON.stringify(contract.learningStepsSeconds)} as const;
export const GRADUATING_INTERVAL = ${contract.graduatingIntervalSeconds} as const;
export const MIN_REVIEW_INTERVAL = ${contract.minimumReviewIntervalSeconds} as const;
export const MIN_EASE = ${contract.minimumEaseFactor} as const;
export const SRS_GOLDEN_FIXTURES = ${JSON.stringify(fixtures.cases, null, 2)} as const;
`;

const swiftOptional = (value) => value == null ? 'nil' : String(value);
const swiftString = (value) => JSON.stringify(value);
const swiftFixtures = fixtures.cases.map((fixture) => `        SRSContractFixture(
            name: ${swiftString(fixture.name)}, answer: ${swiftString(fixture.answer)},
            card: SRSContractState(srsInterval: ${fixture.card.srs_interval}, easeFactor: ${fixture.card.ease_factor}, learningStep: ${swiftOptional(fixture.card.learning_step)}, promptStage: ${fixture.card.prompt_stage}),
            expected: SRSContractExpected(srsInterval: ${fixture.expected.srs_interval}, easeFactor: ${fixture.expected.ease_factor}, learningStep: ${swiftOptional(fixture.expected.learning_step)}, dueSeconds: ${fixture.expected.due_seconds}, correctDelta: ${fixture.expected.correct_delta}, incorrectDelta: ${fixture.expected.incorrect_delta}, promptStage: ${fixture.expected.prompt_stage})
        )`).join(',\n');
const swiftBody = `${banner}
import Foundation

enum GeneratedSRSContract {
    static let sourceHash = ${swiftString(sourceHash)}
    static let algorithmVersion = ${swiftString(contract.algorithmVersion)}
    static let maxPromptStage = ${contract.maxPromptStage}
    static let learningSteps = ${JSON.stringify(contract.learningStepsSeconds)}
    static let graduatingInterval = ${contract.graduatingIntervalSeconds}
    static let minimumReviewInterval = ${contract.minimumReviewIntervalSeconds}
    static let minimumEaseFactor = ${contract.minimumEaseFactor}
    static let goldenFixtures: [SRSContractFixture] = [
${swiftFixtures}
    ]
}

struct SRSContractState {
    let srsInterval: Int
    let easeFactor: Double
    let learningStep: Int?
    let promptStage: Int
}

struct SRSContractExpected {
    let srsInterval: Int
    let easeFactor: Double
    let learningStep: Int?
    let dueSeconds: Int
    let correctDelta: Int
    let incorrectDelta: Int
    let promptStage: Int
}

struct SRSContractFixture {
    let name: String
    let answer: String
    let card: SRSContractState
    let expected: SRSContractExpected
}
`;

const authRequired = apiAuthRequired;
const apiTSBody = `// Generated by scripts/generate-contracts.mjs from contracts/api-v1*.json.\n// Source SHA-256: ${apiSourceHash}\n// Do not edit by hand.\n
export const API_CONTRACT_SOURCE_HASH = '${apiSourceHash}' as const;
export type AccountType = 'student' | 'teacher';
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export interface AuthUser {
  id: string;
  username: string;
  display_name: string | null;
  created_at: string;
  native_language: string | null;
  target_language: string | null;
  daily_new_limit: number;
  daily_word_goal: number;
  total_xp: number;
  account_type: AccountType;
  cefr_level: CefrLevel | null;
}
export interface AuthSession extends AuthUser { token: string; }
export interface APIContractFallbackDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  source: string;
  operation: string;
  correlationId: string;
  occurredAt: string;
  detail?: string;
}
export interface APIContractTranscriptWord { text: string; offset: number; }
export interface APIContractTranscriptSegment {
  text: string;
  offset: number;
  duration: number;
  words: APIContractTranscriptWord[];
}
export interface APIContractTranscriptResponse {
  success: true;
  kind: 'human' | 'automatic';
  selectedLanguage: string | null;
  segments: APIContractTranscriptSegment[];
  fallback_notices: APIContractFallbackDiagnostic[];
}
export interface SocketEnvelope {
  correlationId: string;
  occurredAt: string;
  fallback_notices?: APIContractFallbackDiagnostic[];
}
export interface CallSignal extends SocketEnvelope { callId: string; fromUserId: string; }
export interface GroupCallSignal extends SocketEnvelope { roomId: string; fromUserId: string; }
export type ExtensionMessageType = ${extensionMessageTypes.map((type) => `'${type}'`).join(' | ')};
export interface ExtensionMessage {
  type: ExtensionMessageType;
  correlationId: string;
  occurredAt: string;
  fallback_notices?: APIContractFallbackDiagnostic[];
  [field: string]: unknown;
}
export const AUTH_USER_REQUIRED_FIELDS = ${JSON.stringify(authRequired)} as const;
export const API_GOLDEN_FIXTURES = ${JSON.stringify(apiFixtures, null, 2)} as const;
`;

const apiSwiftBody = `// Generated by scripts/generate-contracts.mjs from contracts/api-v1*.json.\n// Source SHA-256: ${apiSourceHash}\n// Do not edit by hand.\n
import Foundation

let apiContractSourceHash = ${swiftString(apiSourceHash)}
let apiGoldenAuthUserJSON = ${swiftString(JSON.stringify(apiFixtures.authUser))}
let apiGoldenAuthSessionJSON = ${swiftString(JSON.stringify(apiFixtures.authSession))}

struct AuthUser: Codable, Equatable {
    let id: String
    let username: String
    let displayName: String?
    let createdAt: String
    let nativeLanguage: String?
    let targetLanguage: String?
    let dailyNewLimit: Int
    let dailyWordGoal: Int
    let totalXp: Int
    let accountType: String
    let cefrLevel: String?
}

struct AuthResponse: Codable {
    let token: String
    let id: String
    let username: String
    let displayName: String?
    let createdAt: String
    let nativeLanguage: String?
    let targetLanguage: String?
    let dailyNewLimit: Int
    let dailyWordGoal: Int
    let totalXp: Int
    let accountType: String
    let cefrLevel: String?

    var user: AuthUser {
        AuthUser(id: id, username: username, displayName: displayName, createdAt: createdAt,
                 nativeLanguage: nativeLanguage, targetLanguage: targetLanguage,
                 dailyNewLimit: dailyNewLimit, dailyWordGoal: dailyWordGoal,
                 totalXp: totalXp, accountType: accountType, cefrLevel: cefrLevel)
    }
}

struct APIContractFallbackDiagnostic: Codable, Equatable {
    let code: String
    let severity: String
    let title: String
    let message: String
    let source: String
    let operation: String
    let correlationId: String
    let occurredAt: String
    let detail: String?
}

struct APIContractTranscriptWord: Codable, Equatable {
    let text: String
    let offset: Int
}

struct APIContractTranscriptSegment: Codable, Equatable {
    let text: String
    let offset: Int
    let duration: Int
    let words: [APIContractTranscriptWord]
}

struct APIContractTranscriptResponse: Codable, Equatable {
    let success: Bool
    let kind: String
    let selectedLanguage: String?
    let segments: [APIContractTranscriptSegment]
    let fallbackNotices: [APIContractFallbackDiagnostic]
}

struct APIContractGroupCallSignal: Codable, Equatable {
    let roomId: String
    let fromUserId: String
    let correlationId: String
    let occurredAt: String
}

struct APIContractCallSignal: Codable, Equatable {
    let callId: String
    let fromUserId: String
    let correlationId: String
    let occurredAt: String
}

struct APIContractExtensionMessage: Codable, Equatable {
    let type: String
    let correlationId: String
    let occurredAt: String
    let hostname: String?
}

let apiGoldenFallbackDiagnosticJSON = ${swiftString(JSON.stringify(apiFixtures.fallbackDiagnostic))}
let apiGoldenTranscriptResponseJSON = ${swiftString(JSON.stringify(apiFixtures.transcriptResponse))}
let apiGoldenGroupCallSignalJSON = ${swiftString(JSON.stringify(apiFixtures.groupCallSignal))}
let apiGoldenCallSignalJSON = ${swiftString(JSON.stringify(apiFixtures.callSignal))}
let apiGoldenExtensionMessageJSON = ${swiftString(JSON.stringify(apiFixtures.extensionMessage))}
`;

const apiServerBody = `// Generated by scripts/generate-contracts.mjs from contracts/api-v1*.json.\n// Source SHA-256: ${apiSourceHash}\n// Do not edit by hand.\n
export const API_CONTRACT_SOURCE_HASH = '${apiSourceHash}';
export const AUTH_USER_REQUIRED_FIELDS = Object.freeze(${JSON.stringify(authRequired)});
export const API_GOLDEN_FIXTURES = Object.freeze(${JSON.stringify(apiFixtures, null, 2)});
`;

const languagesTSBody = `// Generated by scripts/generate-contracts.mjs from contracts/languages-v1.json.
// Source SHA-256: ${languagesSourceHash}
// Do not edit by hand.
export const LANGUAGE_CONTRACT_SOURCE_HASH = '${languagesSourceHash}' as const;
export const LANGUAGES = ${JSON.stringify(languagesContract.languages, null, 2)} as const;
export const LANGUAGE_NAMES = Object.freeze(Object.fromEntries(LANGUAGES.map((language) => [language.code, language.name]))) as Readonly<Record<string, string>>;
export const PLACEMENT_LANGUAGE_CODES = LANGUAGES.filter((language) => language.placement).map((language) => language.code);
export const CEFR_LEVELS = ${JSON.stringify(languagesContract.cefrLevels)} as const;
`;

const languagesSwiftEntries = languagesContract.languages.map((language) =>
  `        .init(code: ${swiftString(language.code)}, name: ${swiftString(language.name)}, placement: ${language.placement})`).join(',\n');
const languagesSwiftBody = `// Generated by scripts/generate-contracts.mjs from contracts/languages-v1.json.
// Source SHA-256: ${languagesSourceHash}
// Do not edit by hand.
import Foundation

struct LanguageOption: Identifiable, Hashable {
    let code: String
    let name: String
    let placement: Bool
    var id: String { code }
}

enum LanguageOptions {
    static let sourceHash = ${swiftString(languagesSourceHash)}
    static let all: [LanguageOption] = [
${languagesSwiftEntries}
    ]
    static let cefrLevels = ${JSON.stringify(languagesContract.cefrLevels)}
    static let placementCodes = Set(all.filter(\\.placement).map(\\.code))
    static func name(for code: String?) -> String? {
        guard let code else { return nil }
        return all.first(where: { $0.code == code })?.name
    }
}
`;

const languagesServerBody = `// Generated by scripts/generate-contracts.mjs from contracts/languages-v1.json.
// Source SHA-256: ${languagesSourceHash}
// Do not edit by hand.
export const LANGUAGE_CONTRACT_SOURCE_HASH = '${languagesSourceHash}';
export const LANGUAGES = Object.freeze(${JSON.stringify(languagesContract.languages)});
export const LANGUAGE_NAMES = Object.freeze(Object.fromEntries(LANGUAGES.map((language) => [language.code, language.name])));
export const CEFR_LEVELS = Object.freeze(${JSON.stringify(languagesContract.cefrLevels)});
`;

const languagesExtensionBody = `// Generated by scripts/generate-contracts.mjs from contracts/languages-v1.json.
// Source SHA-256: ${languagesSourceHash}
// Do not edit by hand.
globalThis.PolycastLanguageContract = Object.freeze({
  sourceHash: '${languagesSourceHash}',
  languages: Object.freeze(${JSON.stringify(languagesContract.languages)}),
  cefrLevels: Object.freeze(${JSON.stringify(languagesContract.cefrLevels)})
});
`;

const extensionMessagesBody = `// Generated by scripts/generate-contracts.mjs from contracts/extension-messages-v1.json.
// Source SHA-256: ${extensionMessagesSourceHash}
// Do not edit by hand.
globalThis.PolycastExtensionMessageContract = Object.freeze({
  sourceHash: '${extensionMessagesSourceHash}',
  maxBytes: ${extensionMessagesContract.maxBytes},
  popupOnly: Object.freeze(${JSON.stringify(extensionMessagesContract.popupOnly)}),
  messages: Object.freeze(${JSON.stringify(extensionMessagesContract.messages)})
});
`;

const transcriptFixturesTSBody = `// Generated by scripts/generate-contracts.mjs from contracts/transcript-tokenization-v1.fixtures.json.
// Source SHA-256: ${transcriptFixturesSourceHash}
// Do not edit by hand.
export const TRANSCRIPT_FIXTURE_SOURCE_HASH = '${transcriptFixturesSourceHash}' as const;
export const TRANSCRIPT_TOKENIZATION_FIXTURES = ${JSON.stringify(transcriptFixtures, null, 2)} as const;
`;

const transcriptFixturesSwiftBody = `// Generated by scripts/generate-contracts.mjs from contracts/transcript-tokenization-v1.fixtures.json.
// Source SHA-256: ${transcriptFixturesSourceHash}
// Do not edit by hand.
import Foundation

struct TranscriptTokenFixture: Codable { let text: String; let isWord: Bool }
struct TranscriptTokenizationFixture: Codable { let name: String; let input: String; let tokens: [TranscriptTokenFixture] }
struct TranscriptSegmentFixture: Codable { let text: String; let offset: Int; let duration: Int }
struct TranscriptSRTFixture: Codable { let name: String; let input: String; let segments: [TranscriptSegmentFixture] }
struct TranscriptFallbackFixture: Codable { let name: String; let code: String; let visible: Bool; let logged: Bool }
struct TranscriptFixtureContract: Codable {
    let version: Int
    let tokenization: [TranscriptTokenizationFixture]
    let srt: [TranscriptSRTFixture]
    let fallbackCases: [TranscriptFallbackFixture]
}
enum GeneratedTranscriptFixtures {
    static let sourceHash = ${swiftString(transcriptFixturesSourceHash)}
    static let contract: TranscriptFixtureContract = try! JSONDecoder().decode(
        TranscriptFixtureContract.self,
        from: Data(${swiftString(JSON.stringify(transcriptFixtures))}.utf8)
    )
}
`;

const transcriptFixturesExtensionBody = `// Generated by scripts/generate-contracts.mjs from contracts/transcript-tokenization-v1.fixtures.json.
// Source SHA-256: ${transcriptFixturesSourceHash}
// Do not edit by hand.
globalThis.PolycastTranscriptFixtures = Object.freeze(${JSON.stringify(transcriptFixtures)});
`;

const outputs = new Map([
  [path.join(root, 'server/lib/generated/srsContract.js'), jsBody],
  [path.join(root, 'client/src/generated/srsContract.ts'), tsBody],
  [path.join(root, 'ios/Polycast/Sources/Generated/SRSContract.swift'), swiftBody],
  [path.join(root, 'client/src/generated/apiContract.ts'), apiTSBody],
  [path.join(root, 'ios/Polycast/Sources/Generated/APIContract.swift'), apiSwiftBody],
  [path.join(root, 'server/lib/generated/apiContract.js'), apiServerBody],
  [path.join(root, 'client/src/generated/languages.ts'), languagesTSBody],
  [path.join(root, 'ios/Polycast/Sources/Generated/LanguageContract.swift'), languagesSwiftBody],
  [path.join(root, 'server/lib/generated/languages.js'), languagesServerBody],
  [path.join(root, 'extension/generated/languages.js'), languagesExtensionBody],
  [path.join(root, 'extension/generated/messageContract.js'), extensionMessagesBody],
  [path.join(root, 'client/src/generated/transcriptFixtures.ts'), transcriptFixturesTSBody],
  [path.join(root, 'ios/Polycast/Sources/Generated/TranscriptFixtures.swift'), transcriptFixturesSwiftBody],
  [path.join(root, 'extension/generated/transcriptFixtures.js'), transcriptFixturesExtensionBody],
]);

const check = process.argv.includes('--check');
let drift = false;
for (const [outputPath, content] of outputs) {
  if (check) {
    const current = await readFile(outputPath, 'utf8').catch(() => '');
    if (current !== content) {
      console.error(`Generated contract drift: ${path.relative(root, outputPath)}`);
      drift = true;
    }
  } else {
    await writeFile(outputPath, content);
    console.log(`Generated ${path.relative(root, outputPath)}`);
  }
}
if (drift) process.exitCode = 1;
