import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/alice', async (req, res) => {
    try {
        const userMessage = req.body?.request?.original_utterance || "";

        const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4.1-mini",
                messages: [{ role: "user", content: userMessage }]
            })
        }).then(r => r.json());

        const reply = openaiResponse?.choices?.[0]?.message?.content || "Не понял запрос.";

        res.json({
            response: {
                text: reply,
                end_session: false
            },
            version: "1.0"
        });

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

app.get("/", (req, res) => res.send("Alice → ChatGPT bridge работает"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server started on port:", PORT));
