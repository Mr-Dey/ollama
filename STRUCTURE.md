# Project Structure: Automated HA K3s Ollama Deployment & Chat App

This document outlines the organization of the automated High-Availability (HA) deployment scripts and the feature-complete full-stack chat application.

## 1. Root Directory (Provisioning Node)
The central hub for orchestration and lifecycle management.

*   `manage_cluster.sh`: **Primary Entry Point.** A unified script to `install` or `uninstall` the entire stack (HA Cluster, Ollama, Backend, and Frontend).
*   `plan.md`: The original deployment strategy and historical milestones.
*   `DESIGN.md`: The UI/UX specification followed for the frontend (Themes, Layout, Animations).
*   `STRUCTURE.md`: This file (Comprehensive project blueprint).
*   `ollama-ha.yaml`: Kubernetes manifest with **Pod Anti-Affinity**, **Recreate Strategy**, and high-performance resource limits (8 CPU, 16GB RAM).
*   `revert_vms.sh`: Utility to reset remote VMs to a clean snapshot state.

## 2. Chat Application (`/chat-app`)
A full-stack application providing a professional interface for the AI cluster.

### Backend (`/chat-app/backend`)
A Node.js/Express proxy that acts as the intelligent gateway.
*   `server.js`: Enhanced API logic featuring:
    *   **Contextual PDF/Text Parsing**: Leverages `pdf-parse` for document reading.
    *   **Multi-modal routing**: Detects images and auto-switches to the `llava:7b` model.
    *   **RESTful Endpoints**: `/api/chat` (POST) and `/health` (GET).
*   `package.json`: Managed dependencies for file handling and AI communication.

### Frontend (`/chat-app/frontend`)
A modern React (TypeScript) application built for the AI powerhouse.
*   `src/App.tsx`: Advanced UI logic including:
    *   **STT (Speech-to-Text)**: Real-time transcription via Web Speech API.
    *   **TTS (Text-to-Speech)**: Audio playback for AI responses.
    *   **Media Previews**: Thumbnail generation and file tag tracking.
    *   **Dark Mode**: Theme persistence and seamless transitions.
*   `src/App.css`: Professional minimalist styling with CSS Custom Properties (Variables).

## 3. Production Environment (`172.16.9.203` & `172.16.9.253`)
The HA cluster where services are actively running.

*   **Node 1 (`k3s-node-1`):** HA Control Plane + ETCD.
    *   Hosts **Nginx** (Port 3000) and the **Node.js Backend** (Port 5000).
    *   Runs 1 replica of Ollama.
*   **Node 2 (`k3s-node-2`):** HA Control Plane + ETCD.
    *   Runs 1 replica of Ollama (balanced via Anti-Affinity).
*   **Model Synchronization**: All nodes carry `gemma:7b`, `llama3:8b`, and `llava:7b` for consistent failover.

## 4. Network Architecture
| Service | Internal/Local | Remote/Public |
| :--- | :--- | :--- |
| **Chat UI** | `localhost:3000` | `http://172.16.9.203:3000` |
| **Backend API** | `localhost:5000` | `http://172.16.9.203:5000` |
| **Ollama Service** | `cluster.local:11434` | `http://172.16.9.203:31434` |
