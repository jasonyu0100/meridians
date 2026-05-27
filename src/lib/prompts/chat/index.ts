/**
 * Chat prompt builders — system prompts for the chat sidebar.
 *
 * Two surfaces:
 *   - Personas: in-character speakers (Fate / System / World force-personas,
 *     plus per-entity character / location / artifact personas).
 *   - Contexts: the six contextMode prompts (scene / outline / narrative /
 *     compass / investigation / mode) that frame the assistant with the
 *     right data block for the conversation.
 *
 * Every prompt is wrapped in a `<chat-system>` root with structured XML
 * children so the model's read-path is identical across personas and
 * modes and matches the reasoning-prompt style used elsewhere.
 */

export { CHAT_OUTPUT_DISCIPLINE } from './discipline';

export {
  buildFatePersonaPrompt,
  buildSystemPersonaPrompt,
  buildWorldPersonaPrompt,
  buildEntityPersonaPrompt,
  type EntityKind,
} from './personas';

export {
  buildSceneAnchor,
  buildSceneChatPrompt,
  buildOutlineChatPrompt,
  buildNarrativeChatPrompt,
  buildCompassChatPrompt,
  buildInvestigationChatPrompt,
  buildModeChatPrompt,
  buildGameTheoryChatPrompt,
} from './contexts';
