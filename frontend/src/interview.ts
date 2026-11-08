/**
 * 本地题库已下线。
 *
 * 题目现在由后端的 Interview Agent 生成（POST /interviews 建会话，返回第一题；
 * POST /interviews/{id}/answers 提交回答并拿到下一题或追问），复盘走
 * POST /interviews/{id}/evaluation。前端不再自己拼题，否则页面上的问题和
 * 后端的考察点对不上。
 */
export {};
