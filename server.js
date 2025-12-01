import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// DeepSeek model
const MODEL_NAME = "deepseek-chat"; // only one model for now — powerful & multilingual

// История диалогов
const dialogHistory = new Map();

// Автоочистка сессий (30 минут неактивности)
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of dialogHistory.entries()) {
        if (now - session.lastActivity > 30 * 60 * 1000) {
            dialogHistory.delete(id);
        }
    }
}, 10 * 60 * 1000);

// Валидация ключа
if (!process.env.DEEPSEEK_API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY не задан в .env!");
    process.exit(1);
}
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY.trim();
if (process.env.DEEPSEEK_API_KEY.length < 10 || !process.env.DEEPSEEK_API_KEY.startsWith("sk-")) {
    console.error("❌ Некорректный DEEPSEEK_API_KEY — должен начинаться с 'sk-'");
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

        // Приветствие при новой сессии и пустом вводе
        if (!text.trim()) {
            const welcome = "Привет! Я DeepSeek — умный ИИ, созданный в Китае, но говорю по-русски как родной. Чем могу помочь?";
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
                response: { text: "Спасибо за разговор! До новых встреч.", end_session: true },
                version: "1.0"
            });
        }

        // Добавляем реплику пользователя
        data.history.push({ role: "user", content: text });

        // Формируем messages: системное + история (до 6 сообщений)
        const messages = [
            {
                role: "system",
                content: "Ты — DeepSeek, дружелюбный и краткий ассистент для Алисы (Яндекс.Диалоги). Отвечай на русском языке. Избегай markdown, списков и длинных абзацев. Максимум 2–3 предложения."
            },
            ...data.history.slice(-6)
        ];

        // 🔥 Запрос к DeepSeek API
        const deepseekRes = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: messages,
                temperature: 0.7,
                max_tokens: 512,
                stream: false
            })
        });

        if (!deepseekRes.ok) {
            const errText = await deepseekRes.text();
            console.error("🔴 DeepSeek API error:", deepseekRes.status, errText);
            throw new Error(`DeepSeek API ${deepseekRes.status}`);
        }

        const json = await deepseekRes.json();
        const reply = json?.choices?.[0]?.message?.content?.trim() || "";

        if (!reply) {
            throw new Error("Пустой ответ от DeepSeek API");
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
                text: "Похоже, DeepSeek временно задумался... Повторите, пожалуйста.",
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
    console.log(`🚀 DeepSeek-сервер запущен на http://localhost:${PORT}`);
    console.log(`🧠 Модель: ${MODEL_NAME}`);
    console.log(`🔑 DeepSeek API Key: ${process.env.DEEPSEEK_API_KEY.slice(0, 5)}...`);
});