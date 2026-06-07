query 完整流程:

```
query
-> build RetrievalQueryPlan
-> tokenize query
-> tokenize chunks
-> BM25 score / BM25 rank

-> 如果 semantic search 可用：
    query -> embedding vector
    chunks -> embedding vectors
    cosine similarity
    embedding rank
    RRF(BM25 rank, embedding rank)
否则：
    RRF fallback = 只看 BM25 rank

-> section / intent heuristic 加权
-> top chunks
```
