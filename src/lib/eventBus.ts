import { WebSocket } from 'ws';

let sseClients: any[] = [];
let wsClients: WebSocket[] = [];

export function setSseClients(arr: any[]) { sseClients = arr; }
export function setWsClients(arr: WebSocket[]) { wsClients = arr; }
export function getSseClients() { return sseClients; }
export function getWsClients() { return wsClients; }

export function addSseClient(c: any) { sseClients.push(c); }
export function removeSseClient(id: any) { sseClients = sseClients.filter(c => c.id !== id); }
export function addWsClient(c: WebSocket) { wsClients.push(c); }
export function removeWsClient(c: WebSocket) { wsClients = wsClients.filter(x => x !== c); }

export const broadcastEvent = (data: any) => {
  sseClients.forEach((client) => {
    try { client.res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { sseClients = sseClients.filter(c => c.id !== client.id); }
  });
  const payload = JSON.stringify(data);
  wsClients.forEach((client) => {
    try { if (client.readyState === 1) (client as any).send(payload); } catch { wsClients = wsClients.filter(c => c !== client); }
  });
};
