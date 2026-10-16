// Shared sidebar. Every page includes <script src="nav.js"></script> right after <body>.
// To add a page: add one line here and create the .html file.
var NAV = [
  ["Overview", [
    ["index.html", "Home"],
    ["sitemap.html", "Sitemap"],
  ]],
  ["Code", [
    ["workspaces.html", "Workspaces"],
    ["repos.html", "Repositories"],
    ["work-items.html", "Work Items (features / fixes)"],
  ]],
  ["Run locally", [
    ["stacks.html", "Stacks"],
    ["logs.html", "Logs"],
    ["resources.html", "Resources (CPU / RAM / disk)"],
  ]],
  ["Data", [
    ["databases.html", "Databases"],
    ["migrations.html", "Migrations"],
    ["sql.html", "SQL Console"],
    ["db-scripts.html", "Saved Scripts"],
  ]],
  ["Pipelines", [
    ["flows.html", "Flows"],
    ["runs.html", "Runs"],
    ["findings.html", "Findings"],
    ["images.html", "Images & Tags"],
  ]],
  ["Platform", [
    ["plugins.html", "Plugins (tools)"],
    ["connections.html", "Connections & Accounts"],
    ["doctor.html", "Doctor (machine setup)"],
    ["settings.html", "Settings"],
  ]],
];

// Built with DOM methods and textContent (no document.write / innerHTML), so nothing is parsed as HTML.
(function () {
  var here = location.pathname.split("/").pop() || "index.html";
  var parent = document.body.getAttribute("data-parent"); // detail pages highlight their list page

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  var nav = el("nav", null, "sidebar");
  nav.appendChild(el("h2", "devdeck"));
  nav.appendChild(el("p", "workspace: infrabot ▾", "small"));
  NAV.forEach(function (group) {
    nav.appendChild(el("h4", group[0]));
    var ul = el("ul");
    group[1].forEach(function (item) {
      var a = el("a", item[1], item[0] === here || item[0] === parent ? "active" : null);
      a.href = item[0];
      var li = el("li");
      li.appendChild(a);
      ul.appendChild(li);
    });
    nav.appendChild(ul);
  });
  nav.appendChild(el("hr"));
  nav.appendChild(el("p", "Open in VS Code ↗", "small"));
  document.body.insertBefore(nav, document.body.firstChild);
})();
