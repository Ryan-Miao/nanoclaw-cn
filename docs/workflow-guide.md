# 开发工作流指南

> 本文档介绍当前项目的开发工作流

---
## 一、核心流程
```
需求 → brainstorming skill → design.md → 用户确认 → writing-plans → TDD
```
### 详细步骤
1. **brainstorming skill** - 挖掘需求、探索方案，用户选择
2. **生成 design.md** - \`docs/plans/YYYY-MM-DD-<topic>-design.md\`
3. **用户确认** - 批准后继续
4. **writing-plans skill** - 生成 implementation.md
5. **TDD 实现** - 先写测试，再写代码

---
## 二、Hooks 强制执行
### 当前 Hooks
| Hook | 触发条件 | 行为 |
|------|---------|------|
| check-plan | 修改源代码 | 检查今天是否有计划文档 |
| check-tdd | 修改源代码 | 检查是否有对应测试文件 |
### check-plan 逻辑
- 检查 \`docs/plans/YYYY-MM-DD-*.md` 是否存在
- 今天没有计划 → 鋒止编码
### check-tdd 逻辑
- 检查 \`src/main/.../Xxx.kt\` 是否有对应 \`src/test/.../XxxTest.kt\`
- 所有代码（包括 UI）都需要测试
### 豁免规则
| 类型 | check-plan | check-tdd |
|------|------------|-----------|
| docs/ 文件 | ✅ 放行 | ✅ 放行 |
| 测试文件 | ✅ 放行 | ✅ 放行 |
| 纯数据类 | ✅ 放行 | ✅ 放行 |
| UI/业务代码 | ❌ 需要计划 | ❌ 需要测试 |
---
## 三、目录结构
```
docs/
├── handoff.md         # 会话交接
├── workflow-guide.md  # 本文档
├── environment.md     # 环境配置
├── plans/             # 设计 +计划
├── archive/           # 归档
```
