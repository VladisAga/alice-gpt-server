import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/alice', async (req, res) => {
    try {
        const userMessage = req.body?.request?.original_utterance || "";

        // Отправляем запрос на Hugging Face
        const hfResponse = await fetch("https://api-inference.huggingface.co/models/gpt2", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.HF_API_KEY}`, // твой токен HF
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ inputs: userMessage })
        }).then(r => r.json());

        // HF возвращает массив с текстом в поле generated_text
        const reply = hfResponse?.[0]?.generated_text || "Не понял запрос.";

        res.json({
            response: {
                text: reply,
                end_session: false
            },
            version: "1.0"
        });

        console.log("HF Key (first 5 chars):", process.env.HF_API_KEY?.slice(0, 5));

    } catch (err) {
        console.error(err);
        res.json({
            response: {
                text: "Упс. Сервер недоступен.",
                end_session: false
            },
            version: "1.0"
        });
    }
});

app.get("/", (req, res) => res.send("Alice → Hugging Face bridge работает"));

const PORT = process.env.PORT;
app.listen(PORT, () => console.log("Server started on port:", PORT));
