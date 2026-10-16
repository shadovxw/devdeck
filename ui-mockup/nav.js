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

(function () {
  var here = location.pathname.split("/").pop() || "index.html";
  var parent = document.body.getAttribute("data-parent"); // detail pages highlight their list page
  var html = '<nav class="sidebar"><h2>devdeck</h2>';
  html += '<p class="small">workspace: <b>infrabot</b> &#9662;</p>';
  NAV.forEach(function (group) {
    html += "<h4>" + group[0] + "</h4><ul>";
    group[1].forEach(function (item) {
      var active = item[0] === here || item[0] === parent;
      html += '<li><a href="' + item[0] + '"' + (active ? ' class="active"' : "") + ">" + item[1] + "</a></li>";
    });
    html += "</ul>";
  });
  html += '<hr><p class="small">Open in VS Code &#8599;</p></nav>';
  document.write(html);
})();
