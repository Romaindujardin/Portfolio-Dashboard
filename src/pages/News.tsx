import React, { useState, useEffect, useRef } from "react";
import { ExternalLink, Search, Filter, RefreshCw } from "lucide-react";
import { NewsItem } from "../types";
import { format, parse, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { fr } from "date-fns/locale";
import Calendar from "react-calendar";
import type { CalendarProps } from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { Dialog } from "@headlessui/react";

// Ajout styles dark mode pour react-calendar
const calendarDarkStyles = `
  .react-calendar {
    background: #111111 !important;
    color: #f3f4f6 !important;
    border: none !important;
  }
  .react-calendar__tile {
    background: transparent !important;
    color: #f3f4f6 !important;
    border-radius: 6px !important;
  }
  .react-calendar__tile--active,
  .react-calendar__tile--now {
    background: #1a1a1a !important;
    color: #fff !important;
  }
  .react-calendar__tile--hasActive {
    background: #222 !important;
  }
  .react-calendar__month-view__days__day--weekend {
    color: #eab308 !important;
  }
  .react-calendar__navigation button {
    background: transparent !important;
    color: #f3f4f6 !important;
    border: none !important;
  }
`;

const FINNHUB_API_KEY = "d1bogc1r01qsbpuea0i0d1bogc1r01qsbpuea0ig";
const FINNHUB_ENDPOINT = "https://finnhub.io/api/v1/news";
const NEWS_REFRESH_COOLDOWN = 60 * 60 * 1000; // 1h en ms
const FINNHUB_EARNINGS_ENDPOINT = "https://finnhub.io/api/v1/calendar/earnings";

type EarningsItem = {
  symbol: string;
  date: string;
  time: string;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  hour: string;
  quarter: string;
  year: number;
};

const News = () => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("general");
  const [lastRefresh, setLastRefresh] = useState<number>(() => {
    const stored = localStorage.getItem("news_last_refresh");
    return stored ? parseInt(stored, 10) : 0;
  });
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<number | null>(null);
  const [earningsMonth, setEarningsMonth] = useState<string>(() => {
    const today = new Date();
    return format(today, "yyyy-MM");
  });
  const [earnings, setEarnings] = useState<EarningsItem[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEarnings, setModalEarnings] = useState<EarningsItem[]>([]);
  const [modalDay, setModalDay] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"news" | "calendar">("news");

  const categories = [
    { value: "general", label: "General" },
    { value: "forex", label: "Forex" },
    { value: "crypto", label: "Cryptocurrency" },
    { value: "merger", label: "Mergers" },
    { value: "ipo", label: "IPO" },
  ];

  useEffect(() => {
    loadNews();
    // eslint-disable-next-line
  }, [selectedCategory]);

  useEffect(() => {
    // Cooldown timer dynamique
    let interval: number | undefined;
    const updateCooldown = () => {
      if (lastRefresh) {
        const now = Date.now();
        const next = lastRefresh + NEWS_REFRESH_COOLDOWN;
        const diff = next - now;
        setCooldown(diff > 0 ? diff : 0);
      } else {
        setCooldown(0);
      }
    };
    updateCooldown();
    if (lastRefresh) {
      interval = window.setInterval(updateCooldown, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [lastRefresh]);

  useEffect(() => {
    loadEarnings(earningsMonth);
  }, [earningsMonth]);

  const loadNews = async () => {
    setLoading(true);
    try {
      const url = `${FINNHUB_ENDPOINT}?category=${selectedCategory}&token=${FINNHUB_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        setNews(
          data.map((item: any) => ({
            id: item.id?.toString() || item.url || item.headline,
            title: item.headline,
            description: item.summary,
            url: item.url,
            source: item.source,
            publishedAt: item.datetime
              ? new Date(item.datetime * 1000).toISOString()
              : "",
            urlToImage: item.image,
          }))
        );
        setLastRefresh(Date.now());
        localStorage.setItem("news_last_refresh", Date.now().toString());
      } else {
        setNews([]);
      }
    } catch (error) {
      setNews([]);
    } finally {
      setLoading(false);
    }
  };

  const loadEarnings = async (month: string) => {
    setEarningsLoading(true);
    setEarningsError(null);
    try {
      const from = format(
        startOfMonth(parse(month, "yyyy-MM", new Date())),
        "yyyy-MM-dd"
      );
      const to = format(
        endOfMonth(parse(month, "yyyy-MM", new Date())),
        "yyyy-MM-dd"
      );
      const url = `${FINNHUB_EARNINGS_ENDPOINT}?from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && Array.isArray(data.earningsCalendar)) {
        setEarnings(
          data.earningsCalendar.map((item: any) => ({
            symbol: item.symbol,
            date: item.date,
            time: item.time || "",
            epsActual: item.epsActual ?? null,
            epsEstimate: item.epsEstimate ?? null,
            revenueActual: item.revenueActual ?? null,
            revenueEstimate: item.revenueEstimate ?? null,
            hour: item.hour || "",
            quarter: item.quarter || "",
            year: item.year || "",
          }))
        );
      } else {
        setEarnings([]);
      }
    } catch (e) {
      setEarningsError("Failed to load earnings calendar.");
      setEarnings([]);
    } finally {
      setEarningsLoading(false);
    }
  };

  const filteredNews = news.filter(
    (article) =>
      article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      article.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      article.source.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Group earnings by date (YYYY-MM-DD)
  const earningsByDate = earnings.reduce(
    (acc: Record<string, EarningsItem[]>, item) => {
      if (!acc[item.date]) acc[item.date] = [];
      acc[item.date].push(item);
      return acc;
    },
    {}
  );

  // Nouvelle section calendrier visuel
  const renderEarningsCalendar = () => (
    <div className="mt-8 flex flex-col items-center">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">
        Earnings Calendar
      </h2>
      <div className="bg-white rounded-lg shadow p-4 w-full dark:bg-[#111111]">
        <Calendar
          value={calendarDate}
          onChange={(value: CalendarProps["value"]) => {
            if (value instanceof Date) setCalendarDate(value);
            else if (Array.isArray(value) && value[0] instanceof Date)
              setCalendarDate(value[0]);
          }}
          tileContent={({ date, view }: { date: Date; view: string }) => {
            if (view === "month") {
              const key = format(date, "yyyy-MM-dd");
              if (earningsByDate[key]) {
                return (
                  <span className="block mx-auto mt-1 w-2 h-2 rounded-full bg-blue-500"></span>
                );
              }
            }
            return null;
          }}
          onClickDay={(value: Date) => {
            const key = format(value, "yyyy-MM-dd");
            if (earningsByDate[key]) {
              setModalEarnings(earningsByDate[key]);
              setModalDay(key);
              setModalOpen(true);
            }
          }}
          prev2Label={null}
          next2Label={null}
          className="w-full"
        />
      </div>
      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        className="fixed z-50 inset-0 flex items-center justify-center"
      >
        <div
          className="fixed inset-0 bg-black bg-opacity-30"
          aria-hidden="true"
          onClick={() => setModalOpen(false)}
        />
        <div className="relative bg-white rounded-lg shadow-lg p-6 w-full max-w-lg z-10 dark:bg-[#111111]">
          <Dialog.Title className="text-lg font-bold mb-2 text-gray-900 dark:text-gray-100">
            Earnings for{" "}
            {modalDay && !isNaN(Date.parse(modalDay))
              ? format(
                  parse(modalDay, "yyyy-MM-dd", new Date()),
                  "EEEE dd MMMM yyyy"
                )
              : ""}
          </Dialog.Title>
          <button
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            onClick={() => setModalOpen(false)}
          >
            &times;
          </button>
          <div className="overflow-x-auto max-h-96">
            <table className="min-w-full border text-sm dark:text-gray-300">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-800">
                  <th className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                    Symbol
                  </th>
                  <th className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                    Time
                  </th>
                  <th className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                    EPS Actual
                  </th>
                  <th className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                    EPS Estimate
                  </th>
                  <th className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                    Revenue Actual
                  </th>
                  <th className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                    Revenue Estimate
                  </th>
                  <th className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                    Quarter
                  </th>
                  <th className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                    Year
                  </th>
                </tr>
              </thead>
              <tbody>
                {modalEarnings
                  .slice()
                  .sort((a, b) => {
                    if (a.revenueEstimate == null && b.revenueEstimate == null)
                      return 0;
                    if (a.revenueEstimate == null) return 1;
                    if (b.revenueEstimate == null) return -1;
                    return b.revenueEstimate - a.revenueEstimate;
                  })
                  .map((item, idx) => (
                    <tr
                      key={item.symbol + item.date + idx}
                      className="even:bg-gray-50 dark:even:bg-gray-800"
                    >
                      <td className="px-2 py-1 border font-mono text-gray-900 dark:text-gray-100">
                        {item.symbol}
                      </td>
                      <td className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                        {item.time || item.hour}
                      </td>
                      <td className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                        {item.epsActual ?? "-"}
                      </td>
                      <td className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                        {item.epsEstimate ?? "-"}
                      </td>
                      <td className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                        {item.revenueActual
                          ? item.revenueActual.toLocaleString()
                          : "-"}
                      </td>
                      <td className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                        {item.revenueEstimate
                          ? item.revenueEstimate.toLocaleString()
                          : "-"}
                      </td>
                      <td className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                        {item.quarter}
                      </td>
                      <td className="px-2 py-1 border text-gray-900 dark:text-gray-100">
                        {item.year}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </Dialog>
    </div>
  );

  return (
    <div className="w-full py-6">
      <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
        Financial News
      </h1>
      {/* Onglets News / Calendar */}
      <div className="flex mb-6 border-b border-gray-200 dark:border-gray-700">
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors duration-150 ${
            activeTab === "news"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-gray-500 hover:text-blue-500 dark:text-gray-300 dark:hover:text-blue-400"
          }`}
          onClick={() => setActiveTab("news")}
        >
          News
        </button>
        <button
          className={`ml-2 px-4 py-2 font-medium border-b-2 transition-colors duration-150 ${
            activeTab === "calendar"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-gray-500 hover:text-blue-500 dark:text-gray-300 dark:hover:text-blue-400"
          }`}
          onClick={() => setActiveTab("calendar")}
        >
          Calendar
        </button>
      </div>
      {/* Contenu selon l'onglet actif */}
      {activeTab === "news" ? (
        // Section News (déjà existante)
        <>
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-2 px-4">
            <input
              type="text"
              placeholder="Search news..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded px-2 py-1 w-full sm:w-64 bg-white dark:bg-[#111111] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded px-2 py-1 bg-white dark:bg-[#111111] text-gray-900 dark:text-gray-100 focus:outline-none"
            >
              {categories.map((cat) => (
                <option
                  key={cat.value}
                  value={cat.value}
                  className="bg-white dark:bg-[#111111] text-gray-900 dark:text-gray-100"
                >
                  {cat.label}
                </option>
              ))}
            </select>
            <button
              className={`flex items-center gap-1 px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 transition disabled:opacity-50 ${
                cooldown > 0 ? "cursor-not-allowed" : ""
              }`}
              onClick={loadNews}
              disabled={cooldown > 0}
            >
              <RefreshCw size={16} />
              {loading
                ? "Updating..."
                : cooldown > 0
                ? `Refresh (${Math.ceil(cooldown / 60000)}m)`
                : "Refresh"}
            </button>
          </div>
          {loading ? (
            <div className="text-gray-700 dark:text-gray-300">
              Loading news...
            </div>
          ) : filteredNews.length === 0 ? (
            <div className="text-gray-700 dark:text-gray-300">
              No news found.
            </div>
          ) : (
            <div className="space-y-4 px-4">
              {filteredNews.map((article) => (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-white rounded-lg shadow p-4 hover:bg-blue-50 transition dark:bg-[#111111] dark:hover:bg-[#1a1a1a]"
                >
                  <div className="flex flex-col md:flex-row md:items-start gap-4">
                    {/* Partie gauche : texte */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {article.source}
                        </span>
                        <div className="flex items-center space-x-1">
                          <span className="text-gray-500 dark:text-gray-400">
                            {format(
                              new Date(article.publishedAt || ""),
                              "MMM d, yyyy HH:mm"
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="font-semibold text-lg mb-1 flex items-center gap-2 text-gray-900 dark:text-gray-100">
                        {article.title}
                        <ExternalLink
                          size={16}
                          className="inline ml-1 text-blue-400"
                        />
                      </div>
                      <div className="text-gray-700 text-sm mb-2 line-clamp-3 dark:text-gray-300">
                        {article.description}
                      </div>
                    </div>
                    {/* Partie droite : image */}
                    {article.urlToImage && (
                      <img
                        src={article.urlToImage}
                        alt="news visual"
                        className="w-full md:w-48 max-h-40 object-cover rounded md:ml-2"
                      />
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </>
      ) : (
        // Section Calendar
        <>
          {/* Styles dark mode pour react-calendar */}
          <style>{`@media (prefers-color-scheme: dark) {${calendarDarkStyles}}`}</style>
          {renderEarningsCalendar()}
        </>
      )}
    </div>
  );
};

export default News;
