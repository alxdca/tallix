# Custom Postgres image with init script included
FROM postgres:16-alpine

# Copy the init script into the image
COPY init-db.sh /docker-entrypoint-initdb.d/init-db.sh

# Make it executable
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh
