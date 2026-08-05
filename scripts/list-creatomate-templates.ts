const apiKey = process.env.CREATOMATE_API_KEY;
console.log("Using API Key starting with:", apiKey?.substring(0, 5));

if (!apiKey) {
  console.error("Missing CREATOMATE_API_KEY environment variable");
  process.exit(1);
}

async function run() {
  const response = await fetch("https://api.creatomate.com/v1/templates", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Error: ${response.status} - ${text}`);
    return;
  }

  const data = await response.json();
  console.log("Templates found in account:");
  console.log(JSON.stringify(data, null, 2));
}

run();