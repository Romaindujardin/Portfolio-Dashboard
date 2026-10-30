export interface PasswordScore {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
  percent: number;
}

export function scorePassword(pw: string): PasswordScore {
  if (!pw || pw.length === 0) {
    return {
      score: 0,
      label: "Trop court",
      color: "#6b7280",
      percent: 0,
    };
  }

  if (pw.length < 4) {
    return {
      score: 0,
      label: "Trop court (min. 4 car.)",
      color: "#ef4444",
      percent: 15,
    };
  }

  let points = 0;
  if (pw.length >= 6) points++;
  if (pw.length >= 10) points++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) points++;

  const score = Math.min(Math.max(points, 1), 4) as 1 | 2 | 3 | 4;

  switch (score) {
    case 1:
      return {
        score: 1,
        label: "Faible",
        color: "#ef4444",
        percent: 25,
      };
    case 2:
      return {
        score: 2,
        label: "Moyen",
        color: "#f59e0b",
        percent: 50,
      };
    case 3:
      return {
        score: 3,
        label: "Bon",
        color: "#3b82f6",
        percent: 75,
      };
    case 4:
    default:
      return {
        score: 4,
        label: "Très sécurisé",
        color: "#10b981",
        percent: 100,
      };
  }
}
