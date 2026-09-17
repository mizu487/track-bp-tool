(() => {
  const isProtectedPage = document.currentScript?.dataset.requireAuth === "true"
    || new URLSearchParams(window.location.search).get("portal") === "referee";

  if (!isProtectedPage) return;

  const sessionKey = "music-bp-referee-authorized-v1";
  if (sessionStorage.getItem(sessionKey) === "1") return;

  const password = window.prompt("请输入裁判访问密码");
  if (password === "1104") {
    sessionStorage.setItem(sessionKey, "1");
    return;
  }

  if (password !== null) window.alert("密码错误");
  window.location.replace("player.html");
})();
