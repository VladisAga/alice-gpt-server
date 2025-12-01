import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Groq model (choose one)
const MODEL_NAME = "llama-3.1-8b-instant"; // или "llama3-70b-8192", "mixtral-8x7b-32768"

// История диалогов
const dialogHistory = new Map();

// Автоочистка сессий
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of dialogHistory.entries()) {
        if (now - session.lastActivity > 30 * 60 * 1000) {
            dialogHistory.delete(id);
        }
    }
}, 10 * 60 * 1000);

// Валидация ключа
if (!process.env.GROQ_API_KEY) {
    console.error("❌ GROQ_API_KEY не задан в .env!");
    process.exit(1);
}
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY.trim();
if (!process.env.GROQ_API_KEY.startsWith("gsk_")) {
    console.error("❌ Некорректный ключ: должен начинаться с 'gsk_'");
    process.exit(1);
}

app.post("/alice", async (req, res) => {
    try {
        if (!req.body?.session || !req.body?.request) {
            return res.json({
                response: { text: "Некорректный формат запроса.", end_session: false },
                version: "1.0"
            });
        }

        const { session, request } = req.body;
        const sessionId = session.session_id;
        const text = request.original_utterance || "";
        const isNew = session.new;

        // Инициализация сессии
        if (isNew || !dialogHistory.has(sessionId)) {
            dialogHistory.set(sessionId, {
                history: [],
                lastActivity: Date.now()
            });
        }

        const data = dialogHistory.get(sessionId);
        data.lastActivity = Date.now();

        // Приветствие при новой сессии
        if (!text.trim()) {
            const welcome = "Привет! Я LLaMA 3 — мощный ИИ от Meta, работаю через Groq. Чем могу помочь?";
            data.history.push({ role: "assistant", content: welcome });
            return res.json({
                response: { text: welcome, end_session: false },
                version: "1.0"
            });
        }

        // Завершение по ключевым словам
        const lowerText = text.toLowerCase();
        if (lowerText.includes("пока") || lowerText.includes("хватит") || lowerText.includes("стоп")) {
            return res.json({
                response: { text: "Спасибо за разговор! До встречи.", end_session: true },
                version: "1.0"
            });
        }

        // Добавляем реплику пользователя
        data.history.push({ role: "user", content: text });

        // Формируем messages
        const messages = [
            {
                role: "system",
                content: "Ты — LLaMA 3, краткий и дружелюбный ассистент для Алисы. Отвечай на русском, 1–3 предложения, без markdown."
            },
            ...data.history.slice(-6)
        ];

        // 🔥 Запрос к Groq API (OpenAI-совместимый)
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: messages,
                temperature: 0.7,
                max_tokens: 512,
                top_p: 0.95
            })
        });

        if (!groqRes.ok) {
            const errText = await groqRes.text();
            console.error("🔴 Groq API error:", groqRes.status, errText);
            throw new Error(`Groq API ${groqRes.status}`);
        }

        const json = await groqRes.json();
        const reply = json?.choices?.[0]?.message?.content?.trim() || "";

        if (!reply) {
            throw new Error("Пустой ответ от Groq");
        }

        // Обрезка под лимит Алисы (1024 символа)
        let finalReply = reply.length > 1024 ? reply.slice(0, 1020) + "…" : reply;

        // Сохраняем в историю
        data.history.push({ role: "assistant", content: finalReply });
        if (data.history.length > 10) {
            data.history = data.history.slice(-10);
        }

        return res.json({
            response: { text: finalReply, end_session: false },
            version: "1.0"
        });

    } catch (err) {
        console.error("❌ Ошибка в /alice:", err.message);
        return res.json({
            response: {
                text: "Groq временно недоступен. Попробуйте повторить через несколько секунд.",
                end_session: false
            },
            version: "1.0"
        });
    }
});

// Health-check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        time: new Date().toISOString(),
        memory: process.memoryUsage(),
        sessions: dialogHistory.size,
        model: MODEL_NAME
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Groq-сервер запущен на http://localhost:${PORT}`);
    console.log(`🧠 Модель: ${MODEL_NAME}`);
    console.log(`🔑 Groq API Key: ${process.env.GROQ_API_KEY.slice(0, 5)}...`);
});