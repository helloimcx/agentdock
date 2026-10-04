package com.agentdock.a11y;

import java.util.Arrays;
import java.util.List;

public final class NodeCatalogTest {
    private static final class Node implements NodeCatalog.Item {
        final String name;
        final int y, x;
        final boolean shown;
        int index;
        Node(String name, int y, int x, boolean shown) { this.name = name; this.y = y; this.x = x; this.shown = shown; }
        public int top() { return y; }
        public int left() { return x; }
        public boolean interactive() { return shown; }
        public void index(int value) { index = value; }
    }

    public static void main(String[] args) {
        Node container = new Node("empty container", 0, 0, false);
        Node button = new Node("商品按钮", 120, 100, true);
        Node input = new Node("搜索框", 40, 40, true);
        List<Node> all = NodeCatalog.ordered(Arrays.asList(button, container, input));
        List<Node> filtered = NodeCatalog.visible(all, true);
        if (filtered.size() != 2 || filtered.get(0) != input || input.index != 2 || button.index != 3) {
            throw new AssertionError("filtered dump must retain the full catalog's IDs");
        }
        for (Node displayed : filtered) {
            if (NodeCatalog.byIndex(all, displayed.index) != displayed) throw new AssertionError("click/input selected a different node");
        }
        if (NodeCatalog.visible(all, false).get(0).index != 1 || button.index != 3) {
            throw new AssertionError("unfiltered dump changed index domain");
        }
        if (NodeCatalog.byIndex(all, 0) != null || NodeCatalog.byIndex(all, 4) != null) {
            throw new AssertionError("out-of-range index must not select a node");
        }
        System.out.println("NodeCatalog filtered/full selection checks passed");
    }
}
