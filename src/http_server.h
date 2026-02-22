#pragma once
#include <string>
#include <functional>
#include <thread>
#include <atomic>
#include <map>


class HttpServer {
private:
    std::atomic<bool> running;
    std::thread serverThread;
    int port;
    int serverSocket;
    std::map<std::string, std::function<std::string(const std::string&)>> routes;
    
public:
    HttpServer(int port = 8080);
    ~HttpServer();
    
    void start();   
    void stop();   
    void addRoute(const std::string& path, std::function<std::string(const std::string&)> handler); 
    
private:
    void serverLoop();  
    void handleClient(int clientSocket); 
    std::string parseRequest(const std::string& request, std::string& method, std::string& path, std::string& body); 
    std::string createHttpResponse(const std::string& content, const std::string& contentType = "text/html", int statusCode = 200); 
    std::string urlDecode(const std::string& str);
};
