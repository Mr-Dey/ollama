const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const OLLAMA_URL = 'http://localhost:31434/api/chat';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ dest: 'uploads/' });

// Helper to extract text from files
async function extractText(filePath, mimeType) {
    if (mimeType === 'application/pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        return data.text;
    } else if (mimeType.startsWith('text/')) {
        return fs.readFileSync(filePath, 'utf8');
    }
    return '';
}

// Enhanced Chat Endpoint
app.post('/api/chat', upload.array('files'), async (req, res) => {
    try {
        let { message, model = 'llama3:8b', images = [] } = req.body;
        let contextText = '';

        // Process uploaded files (Text/PDF)
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const text = await extractText(file.path, file.mimetype);
                contextText += `\n[File: ${file.originalname}]\n${text}\n`;
                fs.unlinkSync(file.path); // Clean up
            }
        }

        const fullPrompt = contextText ? `Context from files:\n${contextText}\n\nUser Question: ${message}` : message;

        const payload = {
            model: model,
            messages: [{ role: 'user', content: fullPrompt }],
            stream: false
        };

        // If there are images (base64 strings) — normalise to array
        const imagesArr = Array.isArray(images) ? images : (images ? [images] : []);
        if (imagesArr.length > 0) {
            payload.messages[0].images = imagesArr.map(img => img.split(',')[1] || img);
            payload.model = 'llava:7b';
        }

        const response = await axios.post(OLLAMA_URL, payload);

        res.json({
            reply: response.data.message.content,
            model: response.data.model
        });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', nodes: 2 });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enhanced Backend running on port ${PORT}`);
});
