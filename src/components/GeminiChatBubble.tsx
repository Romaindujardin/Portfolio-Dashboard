import React, { useState, useRef } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { getGeminiApiKey } from "../utils/userSettings";

const GeminiChatBubble: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ role: "user" | "ai"; text: string }>
  >([
    {
      role: "ai",
      text: "Bonjour 👋 ! Je suis Gemini, votre assistant IA. Posez-moi n'importe quelle question sur la finance, la crypto, ou autre !",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { currentUser } = useUser();

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const getGeminiApiUrl = (): string => {
    const apiKey = getGeminiApiKey(currentUser);
    if (!apiKey) {
      throw new Error(
        "Clé API Gemini non configurée. Veuillez la configurer dans les paramètres."
      );
    }
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMessage = input.trim();
    setMessages((msgs) => [...msgs, { role: "user", text: userMessage }]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      // Appel direct à Gemini (prompt simple)
      const prompt = userMessage;
      const response = await fetch(getGeminiApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        }),
      });
      const data = await response.json();
      let aiText = "[Erreur de réponse IA]";
      if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
        aiText = data.candidates[0].content.parts[0].text;
      }
      setMessages((msgs) => [...msgs, { role: "ai", text: aiText }]);
    } catch {
      setMessages((msgs) => [
        ...msgs,
        {
          role: "ai",
          text: "Désolé, une erreur est survenue avec Gemini. Vérifiez votre clé API dans les paramètres.",
        },
      ]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  return (
    <>
      {/* Bulle flottante */}
      <button
        className="fixed bottom-6 right-6 z-50 bg-[#111111] text-white rounded-full  w-14 h-14 flex items-center justify-center hover:scale-110 transition-transform border border-[rgba(255,255,255,0.06)]"
        onClick={() => setOpen(true)}
        style={{ display: open ? "none" : "flex" }}
        aria-label="Ouvrir le chatbot Gemini"
      >
        <MessageCircle size={32} />
      </button>

      {/* Popup du chat */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-84 max-w-[95vw] rounded-2xl shadow-2xl border border-[rgba(255,255,255,0.08)] flex flex-col overflow-hidden animate-fade-in bg-[#141414]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)] bg-[#181818] text-[#f5f5f5]">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#c8a55e]"></div>
              <span className="font-semibold text-sm">Assistant Gemini</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[#8a8a8a] hover:text-[#f5f5f5] transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 flex flex-col px-4 py-3 space-y-2.5 overflow-y-auto max-h-80 min-h-[180px] bg-[#0f0f0f]">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`rounded-xl px-3.5 py-2.5 max-w-[90%] whitespace-pre-line text-sm ${
                  msg.role === "user"
                    ? "bg-[#c8a55e] text-[#0a0a0a] font-medium self-end text-right"
                    : "bg-[#181818] border border-[rgba(255,255,255,0.06)] self-start text-left text-[#f5f5f5]"
                }`}
              >
                {msg.text}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form
            className="flex items-center border-t border-[rgba(255,255,255,0.06)] px-3 py-2.5 bg-[#141414]"
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading) sendMessage();
            }}
          >
            <input
              type="text"
              className="flex-1 px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.08)] focus:outline-none focus:ring-1 focus:ring-[#c8a55e] text-sm bg-[#1a1a1a] text-[#f5f5f5] placeholder-[#555555]"
              placeholder="Posez votre question..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!loading) sendMessage();
                }
              }}
            />
            <button
              type="submit"
              className="ml-2 p-2 rounded-full bg-[#111111] hover:bg-[#1a1a1a] text-white disabled:opacity-50 border border-[rgba(255,255,255,0.06)] transition-colors"
              disabled={loading || !input.trim()}
              aria-label="Envoyer"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <Send size={20} />
              )}
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default GeminiChatBubble;
