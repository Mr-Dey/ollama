import React, { useState, useEffect, useRef } from 'react';
import './App.css';

interface Message {
  role: 'user' | 'bot';
  content: string;
  image?: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', content: 'Hello! I am your enhanced AI assistant. I can now handle files, images, and voice! How can I help you?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState('llama3:8b');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Voice Recognition (STT)
  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser doesn't support Speech Recognition.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';

    if (!isListening) {
      recognition.start();
      setIsListening(true);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + ' ' + transcript);
        setIsListening(false);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
    }
  };

  // Text to Speech (TTS)
  const speak = (text: string) => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    synth.speak(utterance);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const docs = files.filter(f => !f.type.startsWith('image/'));
      const imgs = files.filter(f => f.type.startsWith('image/'));

      setSelectedFiles(prev => [...prev, ...docs]);
      
      imgs.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreviewImages(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleSend = async () => {
    if (!input.trim() && previewImages.length === 0) return;

    const userMessage: Message = { 
      role: 'user', 
      content: input, 
      image: previewImages[0] // Show first image in chat for preview
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    const formData = new FormData();
    formData.append('message', input);
    formData.append('model', previewImages.length > 0 ? 'llava:7b' : model);
    
    selectedFiles.forEach(file => formData.append('files', file));
    previewImages.forEach(img => formData.append('images', img));

    try {
      const hostname = window.location.hostname;
      const response = await fetch(`http://${hostname}:5000/api/chat`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'bot', content: data.reply }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'bot', content: 'Error: Could not connect to the server.' }]);
    } finally {
      setLoading(false);
      setSelectedFiles([]);
      setPreviewImages([]);
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>Ollama AI (Multi-Node)</h1>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="model-select">
          <option value="llama3:8b">Llama 3 (8B)</option>
          <option value="gemma:7b">Gemma (7B)</option>
          <option value="llava:7b">Llava (Vision)</option>
        </select>
      </header>

      <div className="messages-list">
        {messages.map((msg, index) => (
          <div key={index} className={`message-item ${msg.role}`}>
            <div className="message-bubble">
              {msg.image && <img src={msg.image} alt="uploaded" className="chat-img" />}
              {msg.content}
              {msg.role === 'bot' && (
                <button className="tts-btn" onClick={() => speak(msg.content)}>🔊</button>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="message-item bot"><div className="message-bubble loading">AI is processing...</div></div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="previews">
        {selectedFiles.map((f, i) => <span key={i} className="file-tag">📄 {f.name}</span>)}
        {previewImages.map((img, i) => <img key={i} src={img} alt="preview" className="img-preview" />)}
      </div>

      <footer className="chat-footer">
        <button className="icon-btn" onClick={() => fileInputRef.current?.click()}>📎</button>
        <button className={`icon-btn ${isListening ? 'listening' : ''}`} onClick={toggleListening}>🎤</button>
        <input
          type="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          accept="image/*,.pdf,.txt,.md"
        />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask anything or upload a file..."
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading || (!input.trim() && previewImages.length === 0)}>
          Send
        </button>
      </footer>
    </div>
  );
}

export default App;
