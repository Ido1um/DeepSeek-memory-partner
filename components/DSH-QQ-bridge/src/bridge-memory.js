// 记忆层适配层。
//
// 真正实现已抽到独立包 `@local/deepseek-memory`（<DSMP_MEMORY_SRC>），
// 桥接通过 node_modules 里的 junction 引用它。桥接代码只认这个文件，
// 以后换实现（sidecar / 新仓库 / 回退旧版）只需改这里或把 junction 指回旧目录。

export * from '@local/deepseek-memory';
export * from '@local/deepseek-memory/digest';
