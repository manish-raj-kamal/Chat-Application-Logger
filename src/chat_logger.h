#pragma once
#include <queue>
#include <string>
#include <unordered_map>
#include <mutex>
#include <fstream>
#include <chrono>
#include <memory>
#include <vector>
#include <sstream>

// Windows byte conflict error

// Record of Sender, Message and Time
struct Message {
    std::string username;
    std::string content;
    std::chrono::system_clock::time_point timestamp;
    
    Message(const std::string& user, const std::string& msg) 
        : username(user), content(msg), timestamp(std::chrono::system_clock::now()) {}
    
    std::string toJson() const;
    static Message fromJson(const std::string& json);
};

// FIFO with max size
class UserMessageQueue {
private:
    std::queue<Message> messages;
    size_t maxSize;
    std::string username;
    mutable std::mutex queueMutex;
    
public:
    UserMessageQueue(const std::string& user, size_t max_size = 100); //Max String Size
    
    void addMessage(const std::string& content);
    void writeToFile(const std::string& logDir = "logs"); // Log
    std::vector<Message> getAllMessages() const;
    size_t size() const;
    bool empty() const;
    void clear(); // Clear queue
};

// JSON file storage
class ChatLogger {
private:
    std::unordered_map<std::string, std::unique_ptr<UserMessageQueue>> userQueues;
    mutable std::mutex loggerMutex;
    size_t maxMessagesPerUser;
    std::string logDirectory;
    std::string jsonFilePath;
    
public:
    ChatLogger(size_t max_messages = 100, const std::string& log_dir = "logs"); // caps and paths
    
    void logMessage(const std::string& username, const std::string& message);
    void writeUserToFile(const std::string& username);
    void writeAllToFiles();
    std::vector<Message> getUserMessages(const std::string& username) const;
    std::vector<std::string> getAllUsers() const;
    void clearUserMessages(const std::string& username);
    size_t getUserMessageCount(const std::string& username) const;
    
    void saveToJson();
    void loadFromJson();
    std::string getAllMessagesJson() const;
    void clearAllData();
    
private:
    void ensureLogDirectory();
    std::string escapeJson(const std::string& str) const;
};
