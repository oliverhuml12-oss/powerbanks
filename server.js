const http = require("http");
const fs = require("fs");
const path = require("path");

const server = http.createServer((req, res) => {
  let filePath;

  if (req.url === "/") {
    filePath = "./public/index.html";

  } else if (req.url.startsWith("/p/")) {
    const id = req.url.split("/")[2];

    const powerbanks = {
      PB001: "new",
      PB002: "borrowed",
      PB003: "expired",
      PB004: "returned",
    };

    const status = powerbanks[id];

    if (!status) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Powerbanka nenalezena");
      return;
    }

    filePath = `./public/powerbank/${status}.html`;

  } else {
    filePath = `./public${req.url}`;
  }

  const extension = path.extname(filePath);

  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
  };

  fs.readFile(filePath, (error, file) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 - Soubor nenalezen");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "text/plain",
    });

    res.end(file);
  });
});

server.listen(3000, () => {
  console.log("Server běží na http://localhost:3000");
});