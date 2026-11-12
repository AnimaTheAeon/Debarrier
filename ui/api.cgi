#!/bin/sh
# Forwards requests from the DeBarrier window to the DeBarrier service.
exec /var/packages/DeBarrier/target/bin/debarrier cgi
