import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Конфигурация модели
const MODEL_CONFIG = {
    model: "microsoft/DialoGPT-medium", // Лучше для диалогов
    parameters: {
        max_new_tokens: 100,
        temperature: 0.9,
        repetition_penalty: 1.2,
        do_sample: true
    }
};

// Хранилище истории диалогов (временное, для демо)
const dialogHistory = new Map();

// Очистка старых сессий каждые 10 минут
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, data] of dialogHistory.entries()) {
        if (now - data.lastActivity > 30 * 60 * 1000) { // 30 минут
            dialogHistory.delete(sessionId);
        }
    }
}, 10 * 60 * 1000);

app.post('/alice', async (req, res) => {
    try {
        // Проверка структуры запроса от Алисы
        if (!req.body || !req.body.session || !req.body.request) {
            return res.status(400).json({
                response: {
                    text: "Некорректный запрос. Проверьте структуру данных.",
                    end_session: false
                },
                version: "1.0"
            });
        }

        const { session, request, version } = req.body;
        const sessionId = session.session_id;
        const userMessage = request.original_utterance || "";
        const isNewSession = request.type === "SimpleUtterance" && session.new;

        // Инициализируем или получаем историю диалога
        if (isNewSession || !dialogHistory.has(sessionId)) {
            dialogHistory.set(sessionId, {
                history: [],
                lastActivity: Date.now()
            });
        }

        const sessionData = dialogHistory.get(sessionId);
        sessionData.lastActivity = Date.now();

        // Добавляем пользовательское сообщение в историю
        sessionData.history.push(`Пользователь: ${userMessage}`);

        // Формируем контекст (последние 4 сообщения)
        const context = sessionData.history.slice(-4).join("\n");

        // Если сообщение пустое (например, запуск навыка)
        if (!userMessage.trim()) {
            const welcomeMessage = "Привет! Я ваш умный помощник, подключенный к ИИ. Чем могу помочь?";
            sessionData.history.push(`Ассистент: ${welcomeMessage}`);

            return res.json({
                response: {
                    text: welcomeMessage,
                    end_session: false
                },
                version: "1.0"
            });
        }

        // Отправляем запрос к Hugging Face API
        const hfResponse = await fetch(
            `https://api-inference.huggingface.co/models/${MODEL_CONFIG.model}`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.HF_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    inputs: context,
                    parameters: MODEL_CONFIG.parameters
                })
            }
        );

        // Проверка ответа от Hugging Face
        if (!hfResponse.ok) {
            console.error(`HF API Error: ${hfResponse.status}`, await hfResponse.text());
            throw new Error(`API вернул ошибку: ${hfResponse.status}`);
        }

        const data = await hfResponse.json();

        // Извлекаем сгенерированный текст
        let reply = data?.[0]?.generated_text || "Не могу обработать ваш запрос.";

        // Извлекаем только последний ответ ассистента
        const lines = reply.split('\n');
        const lastAssistantLine = lines.reverse().find(line =>
            line.startsWith('Ассистент:') || !line.startsWith('Пользователь:')
        );

        if (lastAssistantLine) {
            reply = lastAssistantLine.replace('Ассистент:', '').trim();
        }

        // Очистка ответа от лишних символов
        reply = reply.replace(/<\|endoftext\|>|\n+/g, ' ').trim();

        // Если ответ пустой, используем заглушку
        if (!reply) {
            reply = "Я подумал над вашим вопросом, но не нашел подходящего ответа. Можете переформулировать?";
        }

        // Ограничение длины для Яндекс.Алисы (1024 символа)
        if (reply.length > 1024) {
            reply = reply.substring(0, 1020) + "...";
        }

        // Добавляем ответ в историю
        sessionData.history.push(`Ассистент: ${reply}`);

        // Ограничиваем историю 10 сообщениями
        if (sessionData.history.length > 10) {
            sessionData.history = sessionData.history.slice(-10);
        }

        // Отправляем ответ Алисе
        res.json({
            response: {
                text: reply,
                end_session: false
            },
            version: "1.0"
        });

        console.log(`[${sessionId}] User: "${userMessage}" -> Assistant: "${reply.substring(0, 50)}..."`);

    } catch (err) {
        console.error("Ошибка обработки запроса:", err);

        // Формируем понятный пользователю ответ
        let errorMessage = "Извините, произошла ошибка при обработке запроса.";

        if (err.message.includes("API") || err.message.includes("ключ")) {
            errorMessage = "Проблема с подключением к ИИ. Проверьте настройки API.";
        }

        res.json({
            response: {
                text: errorMessage,
                end_session: false
            },
            version: "1.0"
        });
    }
});

// Эндпоинт для проверки работы сервера
app.get("/", (req, res) => {
    res.json({
        status: "running",
        service: "Alice → Hugging Face Bridge",
        models: "Диалоговые ИИ модели",
        endpoints: {
            alice: "POST /alice",
            health: "GET /health"
        }
    });
});

// Эндпоинт для проверки здоровья
app.get("/health", (req, res) => {
    const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        activeSessions: dialogHistory.size
    };
    res.json(health);
});

// Эндпоинт для сброса сессий (только для отладки)
app.post("/reset-sessions", (req, res) => {
    const before = dialogHistory.size;
    dialogHistory.clear();
    res.json({
        message: "Сессии сброшены",
        clearedSessions: before
    });
});

// Проверка переменных окружения при старте
const PORT = process.env.PORT || 3000;
const HF_API_KEY = process.env.HF_API_KEY;

if (!HF_API_KEY) {
    console.error("❌ ОШИБКА: Не установлен HF_API_KEY в переменных окружения!");
    console.error("Добавьте в .env файл: HF_API_KEY=ваш_токен_здесь");
    process.exit(1);
}

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🔗 Локальная ссылка: http://localhost:${PORT}`);
    console.log(`🧠 Используемая модель: ${MODEL_CONFIG.model}`);
    console.log(`🔑 HF API Key: ${HF_API_KEY.slice(0, 5)}...`);
    console.log("⏳ Очистка неактивных сессий каждые 10 минут");
});