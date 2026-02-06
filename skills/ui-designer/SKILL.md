---
name: ui-designer
description: Design and build user interfaces that adhere to the Selene project's "Floating Dark Mode" aesthetic and UX principles.
trigger: When creating a new screen, component, or improving the visual layout.
allowed-tools: Read, Write, Edit
---

## Purpose

This skill ensures all UI development is consistent with the established Design System, creating a cohesive and premium user experience.

---

## Design System Checklist (REQUIRED)

✅ ALWAYS:

- **Use Base Components:** Build UI using `<Box>` and `<Text>` from `@/components/base`. Never use raw `<View>` or `<Text>`.
- **Respect the Theme:**
  - Colors: Use theme keys (`primary`, `cardBackground`, `textSecondary`). No hex codes.
  - Spacing: Use theme keys (`s`, `m`, `l`, `xl`). No magic numbers.
  - Typography: Use `textVariants` (`header-xl`, `body-md`, `caption-sm`).
- **Follow "Floating UI":** Major elements (Headers, Cards) should have `borderRadius`, `backgroundColor="cardBackground"`, and subtle `shadow/elevation`.
- **i18n:** All user-visible text must come from `useTranslation` (`t('namespace:key')`).
- **Accessibility:** Use `TouchableOpacity` for interactive elements and provide clear labels.

❌ NEVER:

- Hardcode colors, font sizes, or spacing values.
- Use `StyleSheet.create` for layout (use Restyle props instead).
- Create UI that looks out of place with the "Dark Industrial" vibe.

---

## Output Format

When using this skill, the agent must:

1.  Confirm understanding of the required UI.
2.  Reference existing components (`PrimaryButton`, `AppChip`, etc.) that can be reused.
3.  Generate the complete, clean TSX code for the component or screen.
