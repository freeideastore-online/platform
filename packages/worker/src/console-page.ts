import { SECURITY_HEADERS } from './http';

export function renderConsolePage() {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Idea Console - FreeIdeaStore</title>
<meta name="description" content="Browse FreeIdeaStore ideas and sections in the author console.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/console/dist/assets/index.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/console/dist/assets/bundle.js"></script>
</body>
</html>`, {
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}
