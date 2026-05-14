# Project Structure: Automated K3s Ollama Deployment & Chat App

This document outlines the organization of the automated deployment scripts and the full-stack chat application.

## 1. Root Directory (Provisioning Node)
The central hub for orchestration and deployment.

*   `plan.md`: The original and updated deployment strategy (Marked as COMPLETED).
*   `deploy_ai_cluster.sh`: The main idempotent bash script that bootstraps the K3s cluster, scales replicas, and pulls AI models.
*   `revert_vms.sh`: Utility script to revert remote VMs to a clean state via `virsh` (environment specific).
*   `STRUCTURE.md`: This file.

## 2. Chat Application (`/chat-app`)
A full-stack application providing a UI and API for the Ollama cluster.

I'm happy to provide you with a comprehensive list of my capabilities!

**Text-based interactions:**

1. **Chatting**: We can have a conversation using plain text.
2. **Question answering**: I can answer your questions to the best of my knowledge based on my training data.
3. **Generating text**: I can generate text in response to prompts or questions.

**File uploads and manipulations:**

1. **Text file uploading**: You can upload plain text files (e.g., .txt, .md) for me to read or process.
2. **PDF file uploading**: You can upload PDF files, but please note that my ability to understand and manipulate PDFs is limited.

**Image processing:**

1. **Image uploading**: You can upload images in various formats (e.g., .jpg, .png, .gif) for me to describe or recognize.
2. **Image generation**: I can generate simple images using text-based prompts, such as ASCII art or basic diagrams.

**Audio and voice interactions:**

1. **Voice-to-text**: I can transcribe spoken audio into text, but please note that my accuracy may vary depending on the quality of the audio.
2. **Text-to-speech**: I can convert written text into speech using various voices and languages (please check the available options).

**Document creation and editing:**

1. **Document generation**: I can generate simple documents (e.g., reports, articles) based on prompts or templates.
2. **Text summarization**: I can summarize long pieces of text for you.

**Other capabilities:**

1. **Mathematical calculations**: I can perform basic arithmetic operations and some advanced mathematical calculations.
2. **Code generation**: I can generate simple code snippets in various programming languages (e.g., Python, JavaScript).
3. **Translation**: I can translate text from one language to another (please check the available translation options).

Please keep in mind that while I'm a highly advanced AI model, there are limitations to my capabilities. If you have specific questions or requests, feel free to ask, and I'll do my best to help!

### Backend (`/chat-app/backend`)
A Node.js/Express proxy that simplifies communication with the K3s cluster.
*   `server.js`: Enhanced API with support for:
    *   **PDF/Text Parsing**: Extracting context from uploaded documents.
    *   **Multi-modal routing**: Auto-switching to `llava` for image processing.
    *   **Multer Integration**: Handling multi-part form data for file/image uploads.
*   `package.json`: Dependencies (`express`, `axios`, `multer`, `pdf-parse`, `cors`).
*   `Dockerfile`: Containerization setup for the backend.

### Frontend (`/chat-app/frontend`)
A React (TypeScript) application providing a modern chat interface.
*   `src/App.tsx`: Main logic for:
    *   **Voice STT**: Web Speech API integration.
    *   **Voice TTS**: Speech Synthesis API integration.
    *   **File/Image Handling**: Base64 encoding and preview logic.
    *   **Dynamic Host Detection**: Automatically connects to the backend on the same IP.
*   `src/App.css`: Custom Vanilla CSS for the chat interface, including animations and responsive layouts.
*   `Dockerfile`: Setup for building and serving the production React app.

## 3. Remote Master Node (`172.16.9.203`)
The production environment where the services are currently hosted.

*   `/var/www/html/`: Hosts the compiled **React Production Build** served by **Nginx** on port `3000`.
*   `/root/server.js`: The active **Node.js Backend** running via `nohup` on port `5000`.
*   `/root/ollama.yaml`: The Kubernetes manifest for the Ollama deployment (2 Replicas).

## 4. Kubernetes Cluster (K3s)
*   **Master (VM1):** `172.16.9.203` (Control Plane)
*   **Worker (VM2):** `172.16.9.253` (Agent)
*   **Service:** `ollama-service` (NodePort: `31434`)
