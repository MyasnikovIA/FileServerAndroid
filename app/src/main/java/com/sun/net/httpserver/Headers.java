package com.sun.net.httpserver;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class Headers {

    private final Map<String, List<String>> map = new LinkedHashMap<>();

    public void add(String key, String value) {
        if (key == null) return;
        map.computeIfAbsent(key, k -> new ArrayList<>()).add(value);
    }

    public void set(String key, String value) {
        if (key == null) return;
        List<String> list = new ArrayList<>();
        list.add(value);
        map.put(key, list);
    }

    public void remove(String key) {
        map.remove(key);
    }

    public String getFirst(String key) {
        List<String> list = map.get(key);
        return (list != null && !list.isEmpty()) ? list.get(0) : null;
    }

    public List<String> get(String key) {
        List<String> list = map.get(key);
        return list != null ? list : new ArrayList<>();
    }

    public Set<Map.Entry<String, List<String>>> entrySet() {
        return map.entrySet();
    }

    public Set<String> keySet() {
        return map.keySet();
    }

    public boolean containsKey(String key) {
        return map.containsKey(key);
    }

    @Override
    public String toString() {
        return map.toString();
    }
}