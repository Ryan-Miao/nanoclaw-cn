# 混合模式规则
> 规定何时走完整 workflow、何时可以跳过

---
## 默认走完整 workflow
- 新功能开发
- 多文件修改
- 涉及业务逻辑
- API 变更
- 重构（影响多个模块）

---
## 可以跳过 workflow
- 配置文件修改（\`.json\`, `.yaml\`, `.env\`)
- 文档更新（\`.md\`, `.txt\`)
- 单行代码修复（typo, 小 bug）
- 数据录入/迁移
- 注释/格式化
- 依赖更新（\`package.json\`, `requirements.txt\`)

---
## 判断逻辑
should_skip_workflow(changed_files):
    # 如果全部都是豁免类型
    if all(is_exempt_type(f) for f in changed_files)
        return True
    # 如果涉及业务代码
    if any(is_business_logic(f) for f in changed_files)
        return False
    return True
