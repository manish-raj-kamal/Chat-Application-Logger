#include "http_server.h"
#include <iostream>
#include <sstream>
#include <cstring>

#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
    #define close closesocket
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <unistd.h>
#endif

using namespace std;

HttpServer::HttpServer(int port) : port(port), running(false), serverSocket(-1) {
#ifdef _WIN32
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
#endif
}

HttpServer::~HttpServer() {
    stop();
#ifdef _WIN32
    WSACleanup();
#endif
}

void HttpServer::start() {
    if (running.load()) {
        return;
    }
    
    running.store(true);
    serverThread = thread(&HttpServer::serverLoop, this);
    
    cout << "HTTP Server starting on port " << port << endl;
    cout << "Open your browser to http://localhost:" << port << endl;
}

void HttpServer::stop() {
    if (!running.load()) {
        return;
    }
    
    running.store(false);
    
    if (serverSocket != -1) {
        close(serverSocket);
        serverSocket = -1;
    }
    
    if (serverThread.joinable()) {
        serverThread.join();
    }
}

void HttpServer::addRoute(const string& path, function<string(const string&)> handler) {
    routes[path] = handler;
}

void HttpServer::serverLoop() {
    serverSocket = socket(AF_INET, SOCK_STREAM, 0);
    if (serverSocket == -1) {
        cerr << "Error creating socket" << endl;
        running.store(false);
        return;
    }
    
    int opt = 1;
#ifdef _WIN32
    setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR, (char*)&opt, sizeof(opt));
#else
    setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif
    
    struct sockaddr_in address;
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(port);
    
    if (bind(serverSocket, (struct sockaddr*)&address, sizeof(address)) < 0) {
        cerr << "Error binding socket" << endl;
        close(serverSocket);
        running.store(false);
        return;
    }
    
    if (listen(serverSocket, 3) < 0) {
        cerr << "Error listening on socket" << endl;
        close(serverSocket);
        running.store(false);
        return;
    }
    
    cout << "Server listening on port " << port << endl;
    
    while (running.load()) {
        struct sockaddr_in clientAddr;
        socklen_t clientLen = sizeof(clientAddr);
        
        int clientSocket = accept(serverSocket, (struct sockaddr*)&clientAddr, &clientLen);
        if (clientSocket < 0) {
            if (running.load()) {
                cerr << "Error accepting connection" << endl;
            }
            continue;
        }
        
        thread clientThread(&HttpServer::handleClient, this, clientSocket);
        clientThread.detach();
    }
}

void HttpServer::handleClient(int clientSocket) {
    char buffer[4096] = {0};
    int bytesRead = recv(clientSocket, buffer, sizeof(buffer) - 1, 0);
    
    if (bytesRead <= 0) {
        close(clientSocket);
        return;
    }
    
    string request(buffer);
    string method, path, body;
    parseRequest(request, method, path, body);
    
    string response;
    
    cout << "Available routes: ";
    for (const auto& route : routes) {
        cout << "'" << route.first << "' ";
    }
    cout << endl;
    
    auto it = routes.find(path);
    if (it != routes.end()) {
        cout << "Route found for: " << path << endl;
        string content = it->second(body);
        response = createHttpResponse(content);
    } else {
        cout << "No route found for: '" << path << "'" << endl;
        // 404 Not Found
        string content = "<html><body><h1>404 Not Found</h1><p>The requested path was not found.</p></body></html>";
        response = createHttpResponse(content, "text/html", 404);
    }
    
    send(clientSocket, response.c_str(), response.length(), 0);
    close(clientSocket);
}

string HttpServer::parseRequest(const string& request, string& method, string& path, string& body) {
    istringstream stream(request);
    string line;
    
    if (getline(stream, line)) {
        istringstream firstLine(line);
        firstLine >> method >> path;
        
        size_t queryPos = path.find('?');
        if (queryPos != string::npos) {
            path = path.substr(0, queryPos);
        }
        
        // Debug output
        cout << "Request - Method: " << method << ", Path: '" << path << "'" << endl;
    }
    
    while (getline(stream, line) && !line.empty() && line != "\r") {
        // Skip headers
    }

    string bodyLine;
    while (getline(stream, bodyLine)) {
        body += bodyLine + "\n";
    }
    
    return "";
}

string HttpServer::createHttpResponse(const string& content, const string& contentType, int statusCode) {
    ostringstream response;
    
    string statusText = (statusCode == 200) ? "OK" : "Not Found";
    
    response << "HTTP/1.1 " << statusCode << " " << statusText << "\r\n";
    response << "Content-Type: " << contentType << "\r\n";
    response << "Content-Length: " << content.length() << "\r\n";
    response << "Connection: close\r\n";
    response << "\r\n";
    response << content;
    
    return response.str();
}

string HttpServer::urlDecode(const string& str) {
    string result;
    for (size_t i = 0; i < str.length(); ++i) {
        if (str[i] == '%' && i + 2 < str.length()) {
            int value;
            istringstream is(str.substr(i + 1, 2));
            if (is >> hex >> value) {
                result += static_cast<char>(value);
                i += 2;
            } else {
                result += str[i];
            }
        } else if (str[i] == '+') {
            result += ' ';
        } else {
            result += str[i];
        }
    }
    return result;
}
