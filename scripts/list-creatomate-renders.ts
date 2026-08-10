const apiKey = "e76ebc0298654b069394b2c99a56756805c3ca8f49f731786eb994c6d045dafdb419af6bb7d6d5a957cb24b869a58a1d";

async function run() {
  const response = await fetch("https://api.creatomate.com/v1/renders", {
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
  console.log("Renders found in account:");
  console.log(JSON.stringify(data, null, 2));
}

run();
export {};
