export default {
  async fetch(request) {
    const destination = new URL(request.url);
    destination.protocol = "https:";
    destination.hostname = "horarios-village-app.daniel-castillo.workers.dev";

    return Response.redirect(destination.toString(), 302);
  },
};
