require("dotenv").config();
const WebSocket = require("ws");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

const wss = new WebSocket.Server({ port: PORT });

console.log("🚀 AI Call WebSocket Server running on port", PORT);

// ==========================
// Connection Handler
// ==========================
wss.on("connection", (ws, req) => {
    const clientId = uuidv4();
    console.log(`📞 New client connected: ${clientId}`);

    // 🔐 Basic Auth Check (Headers or Query Param)
    const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const token = req.headers["authorization"] || `Bearer ${urlParams.get("token")}`;

    if (token !== `Bearer ${AUTH_TOKEN}`) {
        console.log("❌ Unauthorized connection attempt");
        ws.close(4001, "Unauthorized");
        return;
    }

    let audioBufferQueue = [];
    let isProcessing = false;
    let isAlive = true;

    // ==========================
    // Receive Audio
    // ==========================
    ws.on("message", async (message) => {
        try {
            if (!Buffer.isBuffer(message)) return;

            // Push incoming PCM chunks
            audioBufferQueue.push(message);

            // Process every ~800ms chunk
            if (audioBufferQueue.length >= 8 && !isProcessing) {
                isProcessing = true;

                const audioData = Buffer.concat(audioBufferQueue);
                audioBufferQueue = [];

                const text = await speechToText(audioData);

                if (!text || text.trim() === "") {
                    isProcessing = false;
                    return;
                }

                console.log(`👤 [${clientId}] ${text}`);

                const aiReply = await generateAI(text);

                console.log(`🤖 [${clientId}] ${aiReply}`);

                const audioResponse = await textToSpeech(aiReply);

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(audioResponse);
                }

                isProcessing = false;
            }

        } catch (err) {
            console.error("❌ Processing error:", err.message);
            isProcessing = false;
        }
    });

    // ==========================
    // Heartbeat (keep alive)
    // ==========================
    ws.on("pong", () => (isAlive = true));

    const interval = setInterval(() => {
        if (!isAlive) {
            console.log("💀 Client dead, terminating");
            ws.terminate();
            return;
        }
        isAlive = false;
        ws.ping();
    }, 30000);

    // ==========================
    // Cleanup
    // ==========================
    ws.on("close", () => {
        console.log(`📴 Client disconnected: ${clientId}`);
        clearInterval(interval);
    });

    ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
    });
});


// ==========================
// 🎤 Speech-to-Text (Deepgram)
// ==========================
async function speechToText(audioBuffer) {
    try {
        const res = await axios.post(
            "https://api.deepgram.com/v1/listen",
            audioBuffer,
            {
                headers: {
                    Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
                    "Content-Type": "audio/raw",
                },
                params: {
                    encoding: "linear16",
                    sample_rate: 16000,
                },
            }
        );

        return res.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    } catch (err) {
        console.error("STT error:", err.message);
        return "";
    }
}


// ==========================
// 🧠 LLM (Groq)
// ==========================
async function generateAI(text) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama3-8b-8192",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a smart AI call agent. Speak short, natural, and conversational like a human on phone."
                    },
                    { role: "user", content: text }
                ],
                temperature: 0.7
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return res.data.choices[0].message.content;

    } catch (err) {
        console.error("LLM error:", err.message);
        return "Sorry, can you repeat that?";
    }
}


// ==========================
// 🔊 Text-to-Speech (Cartesia)
// ==========================
async function textToSpeech(text) {
    try {
        const res = await axios.post(
            "https://api.cartesia.ai/tts",
            {
                text: text,
                voice: "female",
                format: "pcm16",
                sample_rate: 16000
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
                    "Content-Type": "application/json",
                },
                responseType: "arraybuffer"
            }
        );

        return Buffer.from(res.data);

    } catch (err) {
        console.error("TTS error:", err.message);
        return Buffer.alloc(0);
    }
}