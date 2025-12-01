import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Используем Mistral API
const MODEL_NAME = "open-mistral-7b"; // mistral-tiny, mistral-small, mistral-medium, mistral-large-latest

const MODEL_PARAMS = {
    max_tokens: 256,
    temperature: 0.8,
    top_p: 0.95,
    random_seed: Math.floor(Math.random() * 10000)
};

// История диалогов
const dialogHistory = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [id, session] of dialogHistory.entries()) {
        if (now - session.lastActivity > 30 * 60 * 1000) {
            dialogHistory.delete(id);
        }
    }
}, 10 * 60 * 1000);

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

        // Приветствие при новой сессии и пустом вводе
        if (!text.trim()) {
            const welcome = "Привет! Я подключён к Mistral AI. Чем могу помочь?";
            data.history.push({ role: "assistant", content: welcome });
            return res.json({
                response: { text: welcome, end_session: false },
                version: "1.0"
            });
        }

        // Добавляем реплику пользователя
        data.history.push({ role: "user", content: text });

        // Формируем messages: системное сообщение + история (до 6 последних)
        const messages = [
            { role: "system", content: "Ты — дружелюбный и краткий ассистент для Алисы (Яндекс.Диалоги). Отвечай на русском языке. Избегай markdown и длинных списков." },
            ...data.history.slice(-6) // ограничим историю, чтобы не превысить лимит токенов
        ];

        // Запрос к Mistral API
        const mistralRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages,
                ...MODEL_PARAMS
            })
        });

        if (!mistralRes.ok) {
            const errText = await mistralRes.text();
            console.error("Mistral API error:", mistralRes.status, errText);
            throw new Error(`Mistral API ${mistralRes.status}: ${errText}`);
        }

        const json = await mistralRes.json();
        const reply = json?.choices?.[0]?.message?.content?.trim() || "";

        if (!reply) {
            throw new Error("Пустой ответ от Mistral API");
        }

        // Обрезка под лимит Алисы (1024 символа)
        let finalReply = reply.length > 1024 ? reply.slice(0, 1020) + "…" : reply;

        // Сохраняем ответ в историю
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
                text: "Похоже, временно не могу ответить. Попробуйте повторить через минуту.",
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

// Проверка переменных окружения
if (!process.env.MISTRAL_API_KEY) {
    console.error("❌ Отсутствует MISTRAL_API_KEY в .env!");
    process.exit(1);
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`🧠 Модель: ${MODEL_NAME}`);
    console.log(`🔑 Mistral API Key: ${process.env.MISTRAL_API_KEY.slice(0, 5)}...`);
});