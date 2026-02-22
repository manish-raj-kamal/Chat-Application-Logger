#include "chat_logger.h"
#include <iostream>
#include <iomanip>
#include <sstream>
#include <filesystem>
#include <regex>

using namespace std; 

// Timestamp
static string formatTimestamp(const chrono::system_clock::time_point& tp) {
    auto time_t = chrono::system_clock::to_time_t(tp);
    stringstream ss;
    ss << put_time(localtime(&time_t), "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

// Message → JSON
string Message::toJson() const {
    stringstream ss;
    auto time_since_epoch = timestamp.time_since_epoch();
    auto milliseconds = chrono::duration_cast<chrono::milliseconds>(time_since_epoch).count();
    
    ss << "{"
       << "\"username\":\"" << username << "\","
       << "\"content\":\"" << content << "\","
       << "\"timestamp\":" << milliseconds
       << "}";
    return ss.str();
}

Message Message::fromJson(const string& json) {
    regex username_regex("\"username\":\"([^\"]*)\"");
    regex content_regex("\"content\":\"([^\"]*)\"");
    regex timestamp_regex("\"timestamp\":(\\d+)");
    
    smatch match;
    string user, content;
    long long timestamp_ms = 0;
    
    if (regex_search(json, match, username_regex)) {
        user = match[1].str();
    }
    if (regex_search(json, match, content_regex)) {
        content = match[1].str();
    }
    if (regex_search(json, match, timestamp_regex)) {
        timestamp_ms = stoll(match[1].str());
    }
    
    Message msg(user, content);
    msg.timestamp = chrono::system_clock::time_point(chrono::milliseconds(timestamp_ms));
    return msg;
}


UserMessageQueue::UserMessageQueue(const string& user, size_t max_size)
    : username(user), maxSize(max_size) {}

void UserMessageQueue::addMessage(const string& content) {
    lock_guard<mutex> lock(queueMutex);
    
    // Add new message
    messages.emplace(username, content);
    
    // If queue exceeds max size, remove oldest message
    if (messages.size() > maxSize) {
        messages.pop();
    }
}

void UserMessageQueue::writeToFile(const string& logDir) {
    lock_guard<mutex> lock(queueMutex);
    
    if (messages.empty()) {
        return;
    }
    
    filesystem::create_directories(logDir);
    
    // Timestamped filename
    auto now = chrono::system_clock::now();
    auto time_t = chrono::system_clock::to_time_t(now);
    
    stringstream filename;
    filename << logDir << "/" << username << "_" 
             << put_time(localtime(&time_t), "%Y%m%d_%H%M%S") 
             << ".log";
    
    ofstream file(filename.str(), ios::app);
    if (!file.is_open()) {
        cerr << "Error: Could not open log file: " << filename.str() << endl;
        return;
    }
    
    // Write header
    file << "=== Chat Log for User: " << username << " ===" << endl;
    file << "Generated at: " << formatTimestamp(now) << endl;
    file << "Total messages: " << messages.size() << endl;
    file << "========================================" << endl << endl;
    
    // Temporary queue to preserve original order
    queue<Message> temp = messages;
    
    while (!temp.empty()) {
        const auto& msg = temp.front();
        file << "[" << formatTimestamp(msg.timestamp) << "] "
             << msg.username << ": " << msg.content << endl;
        temp.pop();
    }
    
    file << endl << "=== End of Log ===" << endl;
    file.close();
    
    cout << "Log written to: " << filename.str() << endl;
}

vector<Message> UserMessageQueue::getAllMessages() const {
    lock_guard<mutex> lock(queueMutex);
    
    vector<Message> result;
    queue<Message> temp = messages;
    
    while (!temp.empty()) {
        result.push_back(temp.front());
        temp.pop();
    }
    
    return result;
}

size_t UserMessageQueue::size() const {
    lock_guard<mutex> lock(queueMutex);
    return messages.size();
}

bool UserMessageQueue::empty() const {
    lock_guard<mutex> lock(queueMutex);
    return messages.empty();
}

void UserMessageQueue::clear() {
    lock_guard<mutex> lock(queueMutex);
    while (!messages.empty()) {
        messages.pop();
    }
}

// ChatLogger Implementation (central manager of all queues).
ChatLogger::ChatLogger(size_t max_messages, const string& log_dir)
    : maxMessagesPerUser(max_messages), logDirectory(log_dir), jsonFilePath(log_dir + "/chat_data.json") {
    ensureLogDirectory();
    loadFromJson();
}

void ChatLogger::logMessage(const string& username, const string& message) {
    lock_guard<mutex> lock(loggerMutex);
    
    if (userQueues.find(username) == userQueues.end()) {
        userQueues[username] = make_unique<UserMessageQueue>(username, maxMessagesPerUser);
    }
    
    userQueues[username]->addMessage(message);
    
    saveToJson();
    
    if (userQueues[username]->size() >= maxMessagesPerUser) {
        userQueues[username]->writeToFile(logDirectory);
        userQueues[username]->clear();
    }
}

void ChatLogger::writeUserToFile(const string& username) {
    lock_guard<mutex> lock(loggerMutex);
    
    auto it = userQueues.find(username);
    if (it != userQueues.end()) {
        it->second->writeToFile(logDirectory);
    }
}

void ChatLogger::writeAllToFiles() {
    lock_guard<mutex> lock(loggerMutex);
    
    for (auto& pair : userQueues) {
        if (!pair.second->empty()) {
            pair.second->writeToFile(logDirectory);
        }
    }
}

vector<Message> ChatLogger::getUserMessages(const string& username) const {
    lock_guard<mutex> lock(loggerMutex);
    
    auto it = userQueues.find(username);
    if (it != userQueues.end()) {
        return it->second->getAllMessages();
    }
    
    return {};
}

vector<string> ChatLogger::getAllUsers() const {
    lock_guard<mutex> lock(loggerMutex);
    
    vector<string> users;
    for (const auto& pair : userQueues) {
        users.push_back(pair.first);
    }
    
    return users;
}

void ChatLogger::clearUserMessages(const string& username) {
    lock_guard<mutex> lock(loggerMutex);
    
    auto it = userQueues.find(username);
    if (it != userQueues.end()) {
        it->second->clear();
    }
}

size_t ChatLogger::getUserMessageCount(const string& username) const {
    lock_guard<mutex> lock(loggerMutex);
    
    auto it = userQueues.find(username);
    if (it != userQueues.end()) {
        return it->second->size();
    }
    
    return 0;
}

void ChatLogger::ensureLogDirectory() {
    filesystem::create_directories(logDirectory);
}

void ChatLogger::saveToJson() {
    
    ofstream file(jsonFilePath);
    if (!file.is_open()) {
        cerr << "Error: Could not save to JSON file: " << jsonFilePath << endl;
        return;
    }
    
    file << "{\n  \"users\": [\n";
    bool first_user = true;
    
    for (const auto& pair : userQueues) {
        if (!first_user) file << ",\n";
        first_user = false;
        
        file << "    {\n      \"username\": \"" << pair.first << "\",\n";
        file << "      \"messages\": [\n";
        
        auto messages = pair.second->getAllMessages();
        bool first_msg = true;
        
        for (const auto& msg : messages) {
            if (!first_msg) file << ",\n";
            first_msg = false;
            file << "        " << msg.toJson();
        }
        
        file << "\n      ]\n    }";
    }
    
    file << "\n  ]\n}";
    file.close();
}

void ChatLogger::loadFromJson() {
    ifstream file(jsonFilePath);
    if (!file.is_open()) {
        return; 
    }
    
    stringstream buffer;
    buffer << file.rdbuf();
    string json_content = buffer.str();
    file.close();
    
    
    regex user_regex("\"username\":\\s*\"([^\"]*)\"");
    regex message_regex("\\{[^}]*\"username\":[^}]*\"content\":[^}]*\"timestamp\":[^}]*\\}");
    
    sregex_iterator user_iter(json_content.begin(), json_content.end(), user_regex);
    sregex_iterator user_end;
    
    for (; user_iter != user_end; ++user_iter) {
        string username = (*user_iter)[1].str();
        if (userQueues.find(username) == userQueues.end()) {
            userQueues[username] = make_unique<UserMessageQueue>(username, maxMessagesPerUser);
        }
    }
    
    sregex_iterator msg_iter(json_content.begin(), json_content.end(), message_regex);
    sregex_iterator msg_end;
    
    for (; msg_iter != msg_end; ++msg_iter) {
        try {
            Message msg = Message::fromJson((*msg_iter).str());
            if (userQueues.find(msg.username) != userQueues.end()) {
                userQueues[msg.username]->addMessage(msg.content);
            }
        } catch (...) {
            // Bad entries are ignored (no crash, bas skip)
        }
    }
}

string ChatLogger::getAllMessagesJson() const {
    lock_guard<mutex> lock(loggerMutex);
    
    stringstream ss;
    ss << "{\n  \"users\": [\n";
    bool first_user = true;
    
    for (const auto& pair : userQueues) {
        if (!first_user) ss << ",\n";
        first_user = false;
        
        ss << "    {\n      \"username\": \"" << escapeJson(pair.first) << "\",\n";
        ss << "      \"messages\": [\n";
        
        auto messages = pair.second->getAllMessages();
        bool first_msg = true;
        
        for (const auto& msg : messages) {
            if (!first_msg) ss << ",\n";
            first_msg = false;
            ss << "        {\n";
            ss << "          \"username\": \"" << escapeJson(msg.username) << "\",\n";
            ss << "          \"content\": \"" << escapeJson(msg.content) << "\",\n";
            ss << "          \"timestamp\": " << chrono::duration_cast<chrono::milliseconds>(msg.timestamp.time_since_epoch()).count() << ",\n";
            ss << "          \"formatted_time\": \"" << formatTimestamp(msg.timestamp) << "\"\n";
            ss << "        }";
        }
        
        ss << "\n      ]\n    }";
    }
    
    ss << "\n  ]\n}";
    return ss.str();
}

void ChatLogger::clearAllData() {
    lock_guard<mutex> lock(loggerMutex);
    userQueues.clear();
    saveToJson();
}

string ChatLogger::escapeJson(const string& str) const {
    string result;
    for (char c : str) { // minimal escaping to keep JSON valid
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += c; break;
        }
    }
    return result;
}
