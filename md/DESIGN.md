DESIGN.md - UI/UX Specification

1. Design Overview

Project: Ollama K3s Chat Application Interface
Design Philosophy: Professional, Minimalist, Function-First.
Core Aesthetic: Clean typography, generous whitespace, subtle animations, and high-contrast elements to support legibility. The interface should feel native, snappy, and free of clutter to emphasize the AI's capabilities (Text, Voice, Vision, Document processing).

2. Global Theming & Color Palette (CSS Variables)

The application must support seamless switching between Light and Dark modes. The agent should implement these as CSS Custom Properties in App.css.

Typography

Primary Font: Inter, Roboto, or system-ui (Sans-serif).

Code Font: JetBrains Mono, Fira Code, or monospace (for AI code snippets).

Scale: Base size 16px. Use 1.5 line height for readability.

CSS Variables (App.css)

/* Base Light Theme */
:root {
  --bg-primary: #f9fafb;       /* App background */
  --bg-secondary: #ffffff;     /* Input area, sidebar, AI message bubble */
  --text-primary: #111827;     /* Main text */
  --text-secondary: #4b5563;   /* Timestamps, placeholder text */
  
  --accent-primary: #2563eb;   /* Professional Blue for primary actions/User bubbles */
  --accent-hover: #1d4ed8;
  --accent-muted: #eff6ff;     /* Light blue for active states */
  
  --border-color: #e5e7eb;     /* Input borders, dividers */
  --danger: #ef4444;           /* Error states */
  --success: #10b981;          /* Connected status */
  
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  --radius-md: 0.5rem;
  --radius-lg: 1rem;
}

/* Dark Theme Overrides */
[data-theme='dark'] {
  --bg-primary: #0f172a;       /* Deep slate app background */
  --bg-secondary: #1e293b;     /* Input area, AI message bubble */
  --text-primary: #f8fafc;     /* Main text */
  --text-secondary: #94a3b8;   /* Timestamps, placeholder text */
  
  --accent-primary: #3b82f6;   /* Slightly lighter blue for dark mode contrast */
  --accent-hover: #60a5fa;
  --accent-muted: #1e3a8a;     /* Dark blue active states */
  
  --border-color: #334155;
}


3. Layout Architecture

The layout should be a single-page app (SPA) spanning 100dvh and 100vw.

3.1. Top Navigation Bar

Placement: Fixed at the top.

Left: Minimalist Logo or App Title (e.g., "K3s AI Hub").

Right Controls:

Status Indicator: A tiny pulsing dot (Green for connected to Node.js backend, Red for disconnected).

Theme Toggle: A sleek Sun/Moon icon to toggle data-theme on the <body>.

3.2. Main Chat Area (flex-1, scrollable)

Container: Max-width restricted (e.g., 800px or 48rem) centered on the screen to prevent text from stretching too wide on desktop.

Message Bubbles:

User Message: Aligned right. Background var(--accent-primary), Text white. Bottom-right corner un-rounded.

AI Message: Aligned left. Background var(--bg-secondary), Border 1px solid var(--border-color). Bottom-left corner un-rounded.

Media Display (Within Bubbles):

Images (llava routing): Rendered as beautifully rounded thumbnails. Clicking expands them (lightbox optional but recommended).

PDF/Text Documents: Rendered as a small card within the user bubble (e.g., 📄 report.pdf (1.2MB)).

Voice TTS Indicator: AI messages should have a small "Speaker" icon appearing on hover to trigger the Speech Synthesis API reading that specific response.

3.3. Input Area (Fixed Bottom)

Container: Floating or docked at the bottom, matching the max-width of the chat area.

File Preview Zone (Dynamic): If a user uploads a file/image before sending, show a thumbnail/file pill above the text input with an "X" to remove it.

Input Field:

Multi-line auto-expanding textarea (up to a max height, then scrolls).

Minimalist border, expanding smoothly.

Action Buttons (Inside the input wrapper):

Attach (Left): Paperclip icon. Opens file dialog for Images/PDFs.

Microphone (Right): Mic icon for Voice STT.

State: When Web Speech API is actively listening, the mic icon should pulse red/accent color.

Send (Right): Arrow or Paper Plane icon. Only active if there is text or a file attached.

4. Component Interactions & Animations (App.css)

To maintain a professional feel, animations should be quick (150ms - 300ms) and purposeful. Avoid bouncy or exaggerated effects.

Message Appearance:

Slide up and fade in.

animation: slideUpFade 0.3s ease-out forwards;

Typing Indicator:

When the API is processing, show a minimal pulsing three-dot indicator inside an AI bubble.

Hover States:

Buttons should slightly shift background color (e.g., to var(--accent-hover)) and cursor should change to pointer.

Theme Transition:

Add a subtle transition to background and text colors globally to make switching modes smooth: transition: background-color 0.3s ease, color 0.3s ease;

5. Agent Implementation Checklist

Instruct the AI Agent to follow this checklist when generating App.tsx and App.css:

[ ] Setup root CSS variables for Light/Dark mode in App.css.

[ ] Implement the ThemeContext or a simple state toggle in App.tsx that updates the data-theme attribute.

[ ] Create the layout structure: Header, ChatWindow, MessageInput.

[ ] Implement the File/Image Preview UI above the input field utilizing Base64 logic.

[ ] Style the Web Speech API (STT) mic button to visually indicate "listening" state.

[ ] Ensure the layout is fully responsive (mobile-friendly input docking).

[ ] Hide default browser scrollbars in the chat window while keeping scroll functionality for a cleaner look.