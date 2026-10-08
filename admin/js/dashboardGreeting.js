const GREETING_NAME_KEY = "lan-cms-dashboard-greeting-name";
const DEFAULT_GREETING_NAME = "Rolando";
const MAX_GREETING_NAME_LENGTH = 24;
const PORTFOLIO_PASS_NAME_KEY = "lan-cms-portfolio-pass-name";
const DEFAULT_PORTFOLIO_PASS_NAME = "LΛN";
const MAX_PORTFOLIO_PASS_NAME_LENGTH = 18;

const GREETINGS = {
  morning: [
    "Good morning, {name}.",
    "Morning, {name}.",
    "Ready when you are, {name}.",
    "Fresh start, {name}.",
    "Let’s build something, {name}."
  ],
  afternoon: [
    "Good afternoon, {name}.",
    "Welcome back, {name}.",
    "Ready when you are, {name}.",
    "Keep it moving, {name}.",
    "Let’s build something, {name}."
  ],
  evening: [
    "Good evening, {name}.",
    "Welcome back, {name}.",
    "Ready when you are, {name}.",
    "Finish strong, {name}.",
    "One more good session, {name}."
  ],
  night: [
    "Still creating, {name}?",
    "Quiet hours, {name}.",
    "Welcome back, {name}.",
    "Ready when you are, {name}.",
    "One more idea, {name}?"
  ]
};

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function sanitizeGreetingName(value, fallback = DEFAULT_GREETING_NAME) {
  const normalized = String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_GREETING_NAME_LENGTH);

  return normalized || fallback;
}

export function getDashboardGreetingName(fallback = DEFAULT_GREETING_NAME) {
  try {
    return sanitizeGreetingName(localStorage.getItem(GREETING_NAME_KEY), fallback);
  } catch (error) {
    return sanitizeGreetingName(fallback, DEFAULT_GREETING_NAME);
  }
}

export function saveDashboardGreetingName(value) {
  const name = sanitizeGreetingName(value);
  localStorage.setItem(GREETING_NAME_KEY, name);
  return name;
}

export function sanitizePortfolioPassName(value, fallback = DEFAULT_PORTFOLIO_PASS_NAME) {
  const normalized = String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PORTFOLIO_PASS_NAME_LENGTH);

  return normalized || fallback;
}

export function getPortfolioPassName(fallback = DEFAULT_PORTFOLIO_PASS_NAME) {
  try {
    return sanitizePortfolioPassName(localStorage.getItem(PORTFOLIO_PASS_NAME_KEY), fallback);
  } catch (error) {
    return sanitizePortfolioPassName(fallback, DEFAULT_PORTFOLIO_PASS_NAME);
  }
}

export function savePortfolioPassName(value) {
  const name = sanitizePortfolioPassName(value);
  localStorage.setItem(PORTFOLIO_PASS_NAME_KEY, name);
  return name;
}

export function getGreetingPeriod(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function buildDashboardGreeting(name = getDashboardGreetingName(), date = new Date()) {
  const safeName = sanitizeGreetingName(name);
  const period = getGreetingPeriod(date);
  const choices = GREETINGS[period];
  const dateSeed = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${safeName}-${period}`;
  const template = choices[hashText(dateSeed) % choices.length];
  return template.replace("{name}", safeName);
}

export { GREETING_NAME_KEY, DEFAULT_GREETING_NAME, MAX_GREETING_NAME_LENGTH, PORTFOLIO_PASS_NAME_KEY, DEFAULT_PORTFOLIO_PASS_NAME, MAX_PORTFOLIO_PASS_NAME_LENGTH };
