package com.agentdock.a11y;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** One index domain for full/filtered dumps and index-based UI actions. */
final class NodeCatalog {
    interface Item {
        int top();
        int left();
        boolean interactive();
        void index(int value);
    }

    static <T extends Item> List<T> ordered(List<T> candidates) {
        List<T> result = new ArrayList<>(candidates);
        result.sort(Comparator.comparingInt((T item) -> item.top() / 40).thenComparingInt(Item::left));
        for (int i = 0; i < result.size(); i++) result.get(i).index(i + 1);
        return result;
    }

    static <T extends Item> List<T> visible(List<T> ordered, boolean interactiveOnly) {
        List<T> result = new ArrayList<>();
        for (T item : ordered) if (!interactiveOnly || item.interactive()) result.add(item);
        return result;
    }

    static <T extends Item> T byIndex(List<T> ordered, int index) {
        return index > 0 && index <= ordered.size() ? ordered.get(index - 1) : null;
    }
}
