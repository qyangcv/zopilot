# Zopilot UI Macro Plan

## Goal

Zopilot UI will move from the current MVP implementation to a mature product-grade UI architecture.

This is a major feature update and technical migration. The goal is to remove existing UI technical debt and migrate to the final long-term UI solution. Large-scale refactoring is expected, and old UI code does not need to be preserved.

## Final Direction

The target architecture is:

Base UI + Zopilot UI Kit + static CSS tokens.

Base UI provides accessible headless interaction primitives.

Zopilot UI Kit owns product components, Zotero environment adaptation, visual consistency, and public UI contracts.

Static CSS tokens define the design language, theme variables, spacing, density, colors, typography, focus rings, motion, and component states.

## Core Principle

Business UI must not use Base UI directly.

All Base UI usage must be wrapped by Zopilot UI Kit so Zotero-specific constraints are handled once: portal containers, focus behavior, chrome window globals, reader iframe boundaries, dark mode, density, and z-index layers.

## Migration Scope

The migration should replace fragile hand-written controls, native select styling, ad hoc popovers, manual menus, and scattered CSS with a coherent component system.

The sidebar should be rebuilt around stable layout primitives, reusable product components, and a clear state boundary between Zotero integration, Codex session logic, and UI rendering.

Reader toolbar integration should remain lightweight and Zotero-native, while complex UI stays in the main Zopilot React surface.

## Future Product Capabilities

The new architecture must support attachment upload, reader content navigation, slash command, custom prompts, skills, and ask/agent mode.

These capabilities should be first-class product flows, not incremental patches on the current MVP layout.

## Success Criteria

The UI becomes predictable, maintainable, visually mature, and resilient across Zotero 9 chrome windows, reader tabs, dark/light themes, long text, resizing, and keyboard interaction.

After this migration, no further UI framework migration should be needed.
