/**
 * HTTP Server Module
 * 
 * Provides an HTTP interface for the MCP server, using Server-Sent Events (SSE)
 * for server-to-client communication and HTTP POST for client-to-server communication.
 */

import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Config } from './config.js';

/**
 * Maps session IDs to their corresponding SSE transports
 */
const sessions = new Map<string, SSEServerTransport>();

/**
 * Extracts the session ID from the request URL
 * Supports both path parameter format (/mcp/message/{sessionId})
 * and query parameter format (/mcp/message?sessionId={sessionId})
 */
function extractSessionId(req: IncomingMessage): string | null {
    const url = req.url || '';
    
    // First try path parameter format
    const pathMatch = url.match(/\/mcp\/message\/([^/?]+)/);
    if (pathMatch) {
        return pathMatch[1];
    }
    
    // Then try query parameter format
    const queryMatch = url.match(/\?.*sessionId=([^&]+)/);
    return queryMatch ? queryMatch[1] : null;
}

/**
 * Add CORS headers to the response
 */
function addCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Starts an HTTP server for the MCP server
 */
export async function startHttpServer(mcpServer: Server, config: Config): Promise<HttpServer> {
    const httpServer = createServer((req, res) => {
        // Add CORS headers
        addCorsHeaders(res);

        // Handle OPTIONS requests for CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Handle SSE connections (GET)
        if (req.method === 'GET' && req.url === '/mcp') {
            console.log('[HTTP] New SSE connection');
            
            // Create a new SSE transport for this connection
            const transport = new SSEServerTransport('/mcp/message', res);
            
            // Store session for routing messages
            const sessionId = transport.sessionId;
            sessions.set(sessionId, transport);
            
            // Handle transport close
            const originalOnClose = transport.onclose;
            transport.onclose = () => {
                console.log(`[HTTP] Session ${sessionId} closed`);
                sessions.delete(sessionId);
                if (originalOnClose) {
                    originalOnClose();
                }
            };
            
            // Connect MCP server to this transport (this automatically calls transport.start())
            mcpServer.connect(transport).catch(error => {
                console.error('[HTTP] Error connecting MCP server to transport:', error);
            });
        }
        // Handle messages (POST)
        else if (req.method === 'POST' && 
                (req.url?.startsWith('/mcp/message/') || 
                 req.url?.startsWith('/mcp/message?'))) {
            // Extract session ID from URL
            const sessionId = extractSessionId(req);
            
            if (sessionId && sessions.has(sessionId)) {
                console.log(`[HTTP] Received message for session ${sessionId}`);
                const transport = sessions.get(sessionId)!;
                transport.handlePostMessage(req, res).catch(error => {
                    console.error('[HTTP] Error handling POST message:', error);
                });
            } else {
                console.error(`[HTTP] Session not found: ${sessionId}`);
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Session not found' }));
            }
        }
        else {
            // Not found
            console.log(`[HTTP] Not found: ${req.method} ${req.url}`);
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    // Handle errors
    httpServer.on('error', (error) => {
        console.error('[HTTP] Server error:', error);
    });

    // Start the server
    return new Promise((resolve) => {
        httpServer.listen(config.http.port, config.http.host, () => {
            console.log(`[HTTP] MCP Server listening on http://${config.http.host}:${config.http.port}/mcp`);
            resolve(httpServer);
        });
    });
}
