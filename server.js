import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Используем бесплатную модель
const MODEL_NAME = "microsoft/DialoGPT-small";

const MODEL_PARAMS = {
    max_new_tokens: 120,
    temperature: 0.8,
    repetition_penalty: 1.2,
    do_sample: true
};

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

        // Создание сессии
        if (isNew || !dialogHistory.has(sessionId)) {
            dialogHistory.set(sessionId, { history: [], lastActivity: Date.now() });
        }

        const data = dialogHistory.get(sessionId);
        data.lastActivity = Date.now();

        if (!text.trim()) {
            const welcome = "Привет! Я подключён к искусственному интеллекту. Что хотите узнать?";
            data.history.push("Ассистент: " + welcome);

            return res.json({
                response: { text: welcome, end_session: false },
                version: "1.0"
            });
        }

        data.history.push("Пользователь: " + text);
        const context = data.history.slice(-4).join("\n");

        // ---- HF API ----
        const hf = await fetch(
            `https://router.huggingface.co/text-generation/${MODEL_NAME}`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.HF_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    inputs: context,
                    parameters: MODEL_PARAMS
                })
            }
        );

        if (!hf.ok) {
            console.error("HF API error:", await hf.text());
            throw new Error("HF API Error " + hf.status);
        }

        const json = await hf.json();

        let answer = json?.[0]?.generated_text || "";

        // Ищем последнюю строку ассистента
        const lines = answer.split("\n");
        let reply = lines.reverse().find(l => l.startsWith("Ассистент:"));

        if (reply) reply = reply.replace("Ассистент:", "").trim();
        else reply = answer.trim();

        // Убираем мусор
        reply = reply.replace(/<\|endoftext\|>/g, "").trim();
        if (!reply) reply = "Я пока не знаю, что ответить. Попробуете иначе сформулировать?";

        // Обрезка для Алисы
        if (reply.length > 1024) reply = reply.slice(0, 1020) + "...";

        data.history.push("Ассистент: " + reply);
        if (data.history.length > 10) data.history = data.history.slice(-10);

        return res.json({
            response: { text: reply, end_session: false },
            version: "1.0"
        });
    } catch (err) {
        console.error("Ошибка:", err);
        return res.json({
            response: {
                text: "Похоже, сервер ИИ временно недоступен.",
                end_session: false
            },
            version: "1.0"
        });
    }
});

// health-check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        time: new Date().toISOString(),
        memory: process.memoryUsage(),
        sessions: dialogHistory.size
    });
});

// Проверка переменных окружения
if (!process.env.HF_API_KEY) {
    console.error("❌ Нет переменной HF_API_KEY в .env!");
    process.exit(1);
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Сервер работает на http://localhost:${PORT}`);
    console.log(`🧠 Модель: ${MODEL_NAME}`);
    console.log(`🔑 Токен: ${process.env.HF_API_KEY.slice(0, 5)}...`);
});
