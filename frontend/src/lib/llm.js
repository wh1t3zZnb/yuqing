/**
 * Call Volcengine (Doubao) API
 * @param {string} apiKey 
 * @param {Array} messages 
 * @param {string} model 
 */
export async function callLLM(apiKey, messages, model = "doubao-seed-1-6-251015") {
    if (!apiKey) throw new Error("API Key is required");

    const url = "/api/volc";

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.7,
                stream: false
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`LLM API Error: ${response.status} - ${err}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error("LLM Call Failed:", error);
        throw error;
    }
}
