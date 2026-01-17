import React, { useState, useEffect, useRef } from "react";
import { RotatingText } from "react-simple-rotating-text";

interface MarketTime {
  name: string;
  timezone: string;
  city: string;
  isOpen: boolean;
}

const MarketClock: React.FC = () => {
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const marketIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const markets: MarketTime[] = [
    {
      name: "Paris",
      timezone: "Europe/Paris",
      city: "Euronext Paris",
      isOpen: true,
    },
    {
      name: "Londres",
      timezone: "Europe/London",
      city: "London Stock Exchange",
      isOpen: true,
    },
    {
      name: "New York",
      timezone: "America/New_York",
      city: "NYSE & NASDAQ",
      isOpen: true,
    },
    {
      name: "Tokyo",
      timezone: "Asia/Tokyo",
      city: "Tokyo Stock Exchange",
      isOpen: true,
    },
    {
      name: "Hong Kong",
      timezone: "Asia/Hong_Kong",
      city: "Hong Kong Stock Exchange",
      isOpen: true,
    },
  ];

  const startMarketInterval = () => {
    // Nettoyer l'intervalle existant s'il y en a un
    if (marketIntervalRef.current) {
      clearInterval(marketIntervalRef.current);
    }

    // Créer un nouvel intervalle
    marketIntervalRef.current = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % markets.length);
        setIsAnimating(false);
      }, 600);
    }, 15000);
  };

  useEffect(() => {
    // Mettre à jour l'heure chaque seconde
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Démarrer l'intervalle de marché
    startMarketInterval();

    return () => {
      clearInterval(timeInterval);
      if (marketIntervalRef.current) {
        clearInterval(marketIntervalRef.current);
      }
    };
  }, [markets.length]);

  const getMarketTime = (market: MarketTime): string => {
    try {
      return currentTime.toLocaleTimeString("fr-FR", {
        timeZone: market.timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (error) {
      return "00:00:00";
    }
  };

  const currentMarket = markets[currentIndex];

  const handleClick = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % markets.length);
      setIsAnimating(false);
    }, 300);

    // Reset le timer après le clic
    startMarketInterval();
  };

  return (
    <div
      className="card w-56 h-32 flex flex-col justify-center overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
      onClick={handleClick}
      title="Cliquer pour changer de bourse"
    >
      <div className="text-center">
        <div className="mb-2">
          <h4
            className={`text-lg font-bold text-gray-900 dark:text-white transition-all duration-300 ${
              isAnimating
                ? "transform -translate-y-4 opacity-0"
                : "transform translate-y-0 opacity-100"
            }`}
          >
            {currentMarket.name}
          </h4>
          <p
            className={`text-xs text-gray-600 dark:text-gray-300 transition-all duration-300 ${
              isAnimating
                ? "transform -translate-y-4 opacity-0"
                : "transform translate-y-0 opacity-100"
            }`}
          >
            {currentMarket.city}
          </p>
        </div>

        <div
          className={`text-2xl font-mono font-bold text-primary-600 mb-2 transition-all duration-300 ${
            isAnimating
              ? "transform -translate-y-4 opacity-0"
              : "transform translate-y-0 opacity-100"
          }`}
        >
          {getMarketTime(currentMarket)}
        </div>
      </div>
    </div>
  );
};

export default MarketClock;
