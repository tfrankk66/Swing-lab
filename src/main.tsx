import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import App from "./App";
import { theme } from "./theme";

// Mantine's stylesheet first, ours second: everything in styles.css now is
// either a canvas the library has no opinion about or a deliberate override,
// and both need to win.
import "@mantine/core/styles.css";
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
