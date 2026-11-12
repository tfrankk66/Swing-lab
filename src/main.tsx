import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import App from "./App";
import { theme } from "./theme";

/*
 * Mantine's CSS, imported per component rather than as `@mantine/core/styles.css`.
 *
 * The full bundle is 234KB and carries every component in the library — a
 * calendar, a rich text editor's chrome, a dozen inputs this app has no use
 * for. That is the wrong trade here specifically: Swing Lab installs as a PWA
 * and is meant to work at a driving range with no signal, so what it ships is
 * what has to arrive over a bad connection once and then live in a cache.
 *
 * The rule for editing this list: **every Mantine component used anywhere in
 * the app needs its file here, plus the files of anything it renders
 * internally.** Those internal dependencies are the part that bites — `Modal`
 * alone pulls in ModalBase, Overlay, Paper, CloseButton and ScrollArea, and a
 * missing one does not error, it silently renders unstyled.
 *
 * `mantine-css.test.tsx` enforces this in both directions. It renders every
 * panel, collects the hashed class names Mantine actually put in the DOM, and
 * fails if any of them comes from a file this list does not import — so adding
 * a component without its CSS breaks the suite rather than the app. It also
 * fails on the reverse, an import nothing renders, which is what keeps the
 * list from silently growing back toward the full bundle.
 *
 * One consequence worth knowing: `Loader.css` is deliberately absent, because
 * `Button` and `ActionIcon` only render a loader when given `loading` and
 * nothing here does. The first `loading` button added to this app will need
 * it, and will need a test that renders one.
 */

// Base. Required, in this order, before any component file.
import "@mantine/core/styles/baseline.css";
import "@mantine/core/styles/default-css-variables.css";
import "@mantine/core/styles/global.css";

// Primitives that other components render inside themselves.
import "@mantine/core/styles/UnstyledButton.css";
import "@mantine/core/styles/CloseButton.css";
import "@mantine/core/styles/Overlay.css";
import "@mantine/core/styles/Paper.css";
import "@mantine/core/styles/Input.css";
import "@mantine/core/styles/ScrollArea.css";
import "@mantine/core/styles/FloatingIndicator.css";
import "@mantine/core/styles/ModalBase.css";

// Layout.
import "@mantine/core/styles/Group.css";
import "@mantine/core/styles/Stack.css";
import "@mantine/core/styles/SimpleGrid.css";

// Typography.
import "@mantine/core/styles/Text.css";
import "@mantine/core/styles/Title.css";
import "@mantine/core/styles/Anchor.css";
import "@mantine/core/styles/List.css";
import "@mantine/core/styles/Divider.css";

// Controls and panels the app actually uses.
import "@mantine/core/styles/Button.css";
import "@mantine/core/styles/ActionIcon.css";
import "@mantine/core/styles/Badge.css";
import "@mantine/core/styles/Alert.css";
import "@mantine/core/styles/Progress.css";
import "@mantine/core/styles/SegmentedControl.css";
import "@mantine/core/styles/Accordion.css";
import "@mantine/core/styles/NumberInput.css";
import "@mantine/core/styles/Modal.css";

// Ours last, so a deliberate override wins over the library.
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    {/* "auto" follows the OS, which is what the two prefers-color-scheme
        blocks in the old stylesheet did. The script has to run before first
        paint or the app flashes light before switching. */}
    <ColorSchemeScript defaultColorScheme="auto" />
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </StrictMode>,
);
