#!/usr/bin/env node

/**
 * Weather MCP Server - TypeScript Example
 * Fetches real weather data and provides it to Claude
 * Uses OpenWeatherMap API (free tier available)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Weather API configuration
const WEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || "";
const WEATHER_API_BASE = "https://api.openweathermap.org/data/2.5";

interface WeatherData {
  temperature: number;
  feels_like: number;
  condition: string;
  description: string;
  humidity: number;
  wind_speed: number;
  city: string;
  country: string;
}

/**
 * Fetch weather data from OpenWeatherMap API
 */
async function fetchWeather(city: string): Promise<WeatherData> {
  const url = `${WEATHER_API_BASE}/weather?q=${encodeURIComponent(
    city
  )}&appid=${WEATHER_API_KEY}&units=metric`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Weather API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();

  return {
    temperature: Math.round(data.main.temp),
    feels_like: Math.round(data.main.feels_like),
    condition: data.weather[0].main,
    description: data.weather[0].description,
    humidity: data.main.humidity,
    wind_speed: Math.round(data.wind.speed * 3.6), // Convert m/s to km/h
    city: data.name,
    country: data.sys.country,
  };
}

/**
 * Fetch weather forecast for the next few days
 */
async function fetchForecast(city: string, days: number = 5): Promise<any> {
  const url = `${WEATHER_API_BASE}/forecast?q=${encodeURIComponent(
    city
  )}&appid=${WEATHER_API_KEY}&units=metric&cnt=${days * 8}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Forecast API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();

  // Group by day and get daily summaries
  const dailyData = data.list.reduce((acc: any[], item: any) => {
    const date = item.dt_txt.split(" ")[0];
    if (!acc.find((d) => d.date === date)) {
      acc.push({
        date,
        temp_min: item.main.temp_min,
        temp_max: item.main.temp_max,
        condition: item.weather[0].main,
        description: item.weather[0].description,
      });
    }
    return acc;
  }, []);

  return {
    city: data.city.name,
    country: data.city.country,
    forecast: dailyData.slice(0, days),
  };
}

/**
 * Create and configure the MCP server
 */
const server = new Server(
  {
    name: "weather-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Define available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_current_weather",
        description:
          "Get the current weather for a specific city. Returns temperature, conditions, humidity, and wind speed.",
        inputSchema: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description:
                "City name (e.g., 'London', 'New York', 'Tokyo'). Can include country code for precision (e.g., 'London,UK')",
            },
          },
          required: ["city"],
        },
      },
      {
        name: "get_weather_forecast",
        description:
          "Get weather forecast for the next few days for a specific city.",
        inputSchema: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "City name (e.g., 'London', 'New York', 'Tokyo')",
            },
            days: {
              type: "number",
              description: "Number of days to forecast (1-5, default: 3)",
              default: 3,
            },
          },
          required: ["city"],
        },
      },
      {
        name: "compare_weather",
        description: "Compare current weather between two cities.",
        inputSchema: {
          type: "object",
          properties: {
            city1: {
              type: "string",
              description: "First city name",
            },
            city2: {
              type: "string",
              description: "Second city name",
            },
          },
          required: ["city1", "city2"],
        },
      },
    ] as Tool[],
  };
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error("Arguments are required for this tool");
  }

  try {
    if (!WEATHER_API_KEY) {
      return {
        content: [
          {
            type: "text",
            text: "Error: OPENWEATHER_API_KEY environment variable not set. Please get a free API key from https://openweathermap.org/api",
          },
        ],
      };
    }

    switch (name) {
      case "get_current_weather": {
        const weather = await fetchWeather(args.city as string);
        const result = `Current Weather in ${weather.city}, ${weather.country}:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌡️  Temperature: ${weather.temperature}°C (feels like ${weather.feels_like}°C)
☁️  Condition: ${weather.condition} - ${weather.description}
💧 Humidity: ${weather.humidity}%
💨 Wind Speed: ${weather.wind_speed} km/h`;

        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "get_weather_forecast": {
        const days = (args.days as number) || 3;
        const forecast = await fetchForecast(args.city as string, days);

        let result = `${days}-Day Weather Forecast for ${forecast.city}, ${forecast.country}:\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        forecast.forecast.forEach((day: any, index: number) => {
          result += `Day ${index + 1} (${day.date}):\n`;
          result += `  🌡️  ${Math.round(day.temp_min)}°C - ${Math.round(
            day.temp_max
          )}°C\n`;
          result += `  ☁️  ${day.condition} - ${day.description}\n\n`;
        });

        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "compare_weather": {
        const [weather1, weather2] = await Promise.all([
          fetchWeather(args.city1 as string),
          fetchWeather(args.city2 as string),
        ]);

        const tempDiff = Math.abs(weather1.temperature - weather2.temperature);
        const warmer =
          weather1.temperature > weather2.temperature
            ? weather1.city
            : weather2.city;

        const result = `Weather Comparison:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${weather1.city}, ${weather1.country}:
  🌡️  ${weather1.temperature}°C (feels like ${weather1.feels_like}°C)
  ☁️  ${weather1.condition} - ${weather1.description}
  💧 ${weather1.humidity}% humidity

${weather2.city}, ${weather2.country}:
  🌡️  ${weather2.temperature}°C (feels like ${weather2.feels_like}°C)
  ☁️  ${weather2.condition} - ${weather2.description}
  💧 ${weather2.humidity}% humidity

📊 Comparison:
  ${warmer} is ${tempDiff}°C warmer`;

        return {
          content: [{ type: "text", text: result }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});